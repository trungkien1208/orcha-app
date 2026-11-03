// The low-fuel watch (Settings › Hand-off): once a minute, the fuel left on
// the Claude account in use against the three marks. Under the checklist
// mark, the agent in front of you is asked for a checklist; under the offer
// mark, a note offers to switch; under the auto mark, the chat moves to the
// account with the most fuel, once the agent is between turns. Each mark
// fires once per account and plan window.

import { agents, notify, setShared } from "herdr";
import { fuelLeft } from "./ui.js";
import { readAccounts, readHandoff, activateAccount, handOff, restartOn, askForChecklist, focusedAgent } from "./accounts-data.js";

// The tighter of an account's limits, and when that window resets.
function fuel(account) {
  const windows = [account.limits?.session, account.limits?.weekly].filter((e) => fuelLeft(e) != null);
  if (!windows.length) return null;
  const tight = windows.reduce((a, b) => (fuelLeft(b) < fuelLeft(a) ? b : a));
  return { left: fuelLeft(tight), resets: tight[1] };
}

export default class HandoffWatch {
  constructor() {
    this.fired = new Set();
  }

  check(cx) {
    cx.spawn(async () => {
      const h = await readHandoff();
      if (!h.checklist_percent && !h.low_fuel_percent && !h.auto_handoff_percent) return;
      const { list, active } = await readAccounts();
      const account = list.find((a) => a.id === active);
      const now = account && fuel(account);
      if (!now) return;
      const once = (mark) => {
        const key = `${account.id}:${mark}:${now.resets}`;
        if (this.fired.has(key)) return false;
        this.fired.add(key);
        return true;
      };
      const label = account.label ?? account.id;
      const others = list.filter((a) => a.kind === "claude" && a.id !== active).map((a) => ({ a, f: fuel(a) })).filter((x) => x.f && x.f.left > now.left);
      const best = others.sort((x, y) => y.f.left - x.f.left)[0]?.a ?? null;

      if (h.auto_handoff_percent && now.left < h.auto_handoff_percent && best) {
        const from = focusedAgent();
        const between = from && agents().find((a) => a.pane === from.pane)?.status !== "working";
        if (between && once("auto")) {
          const way = h.switch_mode === "restart" ? "restart" : h.switch_mode === "new_pane" ? "new_pane" : "keep";
          const failed = way === "keep" ? await activateAccount(best.id) : way === "restart" ? await restartOn(best) : await handOff(best, { checklistFile: h.checklist_file });
          notify(failed ? { title: "orcha could not switch accounts", body: failed, level: "error" } : { title: `${label} is almost empty: moved to ${best.label ?? best.id}`, level: "success", timeout: 8000 });
        }
        return;
      }
      if (h.low_fuel_percent && now.left < h.low_fuel_percent && once("offer")) {
        // Settings opens on Accounts for a couple of minutes after this.
        setShared("orcha.openSection", { id: "accounts", until: Date.now() + 120000 });
        notify({
          title: `${label} has ${now.left}% left`,
          body: best ? `${best.label ?? best.id} has ${fuel(best).left}%. Click to switch, or use HAND OFF in Accounts.` : "Click to see your accounts.",
          level: "warning",
          timeout: 15000,
          action: { name: "mod.open", args: { name: "orcha" } },
        });
      }
      if (h.checklist_percent && now.left < h.checklist_percent && focusedAgent() && once("checklist")) {
        const failed = await askForChecklist(h.checklist_file);
        if (!failed) notify({ title: `Fuel under ${h.checklist_percent}%: asked the agent for a checklist`, body: h.checklist_file, level: "info", timeout: 6000 });
      }
    });
  }
}
