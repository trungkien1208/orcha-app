// orcha for the Herdr app: one mod, placed several times in the orcha layout
// with props { part }: header, left, tabs, pane (each pane's title bar),
// panel and status. The parts
// share orcha's look from ui.js.

import { View } from "gpui-kit";
import { props } from "herdr";
import Header from "./header.js";
import Left from "./left.js";
import Tabs from "./tabs.js";
import Pane from "./pane.js";
import Panel from "./panel.js";
import Status from "./status.js";
import Accounts from "./accounts.js";
import Menu from "./menu.js";
import Icon from "./icon.js";
import Settings from "./settings.js";

const PARTS = { header: Header, left: Left, tabs: Tabs, pane: Pane, panel: Panel, status: Status, accounts: Accounts, menu: Menu, icon: Icon, settings: Settings };

export default class Orcha extends View {
  init(_props, cx) {
    // Opened on its own as an overlay (`mod.open orcha`, ⌘,): SETTINGS.
    const part = props()?.part ?? (props()?.overlay ? "settings" : "left");
    const Part = PARTS[part] ?? Left;
    this.part = new Part(cx);
  }

  render(cx) {
    return this.part.render(cx);
  }
}
