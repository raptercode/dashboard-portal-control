import { h, icon } from "./dom.js";
let sequence = 0;
// A menu whose options can carry a logo, a description and a tag.
//   picker({ label, name, value, options, onChange, hint, disabled })
// An option is { value, label, detail?, mark?: () => Node, tag?, disabled?, title? }.
// The returned element exposes `value` (set it without firing onChange),
// `setOptions(options)` and `setDisabled(flag)`. A hidden input named `name`
// carries the value into the form. DOM focus stays on the trigger; the option
// being highlighted is announced through aria-activedescendant.
export function picker({
  label,
  name,
  value = "",
  options = [],
  onChange,
  hint,
  disabled = false,
}) {
  const id = `picker-${++sequence}`;
  let items = options;
  let current = String(value ?? "");
  let active = 0;
  const field = h("input", { type: "hidden", name, value: current });
  const title = h("span", { id: `${id}-label` }, label);
  const mark = h("span", { class: "picker-mark" });
  const text = h("span", { class: "picker-text" });
  const trigger = h(
    "button",
    {
      type: "button",
      class: "picker-trigger",
      role: "combobox",
      "aria-haspopup": "listbox",
      "aria-expanded": "false",
      "aria-controls": `${id}-list`,
      "aria-labelledby": `${id}-label`,
      disabled,
    },
    mark,
    text,
    icon("chevron"),
  );
  const list = h("div", {
    id: `${id}-list`,
    class: "picker-list",
    role: "listbox",
    "aria-labelledby": `${id}-label`,
    hidden: true,
  });
  const root = h(
    "div",
    { class: "field picker" },
    title,
    field,
    h("div", { class: "picker-anchor" }, trigger, list),
    hint && h("small", {}, hint),
  );
  const selected = () => items.find((item) => item.value === current) || items[0];
  const optionNodes = () => [...list.children];
  const paint = () => {
    const item = selected();
    mark.replaceChildren(item?.mark?.() || "");
    text.replaceChildren(
      h("b", {}, item?.label || ""),
      item?.detail && h("small", {}, item.detail),
    );
    list.replaceChildren(
      ...items.map((entry, index) =>
        h(
          "button",
          {
            type: "button",
            role: "option",
            class: "picker-option",
            id: `${id}-o${index}`,
            tabIndex: -1,
            title: entry.title,
            "aria-label": entry.label,
            "aria-selected": String(entry.value === item?.value),
            "aria-disabled": entry.disabled ? "true" : null,
            onclick: () => choose(entry),
            onmouseenter: () => highlight(index),
          },
          h("span", { class: "picker-mark" }, entry.mark?.() || ""),
          h(
            "span",
            { class: "picker-text" },
            h("b", {}, entry.label),
            entry.detail && h("small", {}, entry.detail),
          ),
          entry.tag && h("span", { class: "picker-tag" }, entry.tag),
          entry.value === item?.value && icon("check"),
        ),
      ),
    );
    if (!list.hidden) highlight(Math.min(active, items.length - 1));
  };
  const highlight = (index) => {
    active = index;
    optionNodes().forEach((node, i) => node.classList.toggle("active", i === index));
    const node = optionNodes()[index];
    if (node) {
      trigger.setAttribute("aria-activedescendant", node.id);
      node.scrollIntoView({ block: "nearest" });
    }
  };
  const outside = (event) => {
    if (!root.contains(event.target)) toggle(false);
  };
  function toggle(open, restoreFocus = false) {
    list.hidden = !open;
    trigger.setAttribute("aria-expanded", String(open));
    if (open) {
      highlight(Math.max(0, items.findIndex((item) => item.value === current)));
      document.addEventListener("pointerdown", outside, true);
    } else {
      trigger.removeAttribute("aria-activedescendant");
      document.removeEventListener("pointerdown", outside, true);
      if (restoreFocus) trigger.focus();
    }
  }
  function choose(entry) {
    if (!entry || entry.disabled) return;
    toggle(false, true);
    if (entry.value === current) return;
    current = entry.value;
    field.value = current;
    paint();
    onChange?.(current);
  }
  const step = (from, direction) => {
    for (let i = 1; i <= items.length; i++) {
      const index = (from + direction * i + items.length * i) % items.length;
      if (!items[index].disabled) return index;
    }
    return from;
  };
  trigger.addEventListener("click", () => toggle(list.hidden));
  trigger.addEventListener("keydown", (event) => {
    const open = !list.hidden;
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      toggle(false, true);
    } else if (event.key === "Tab" && open) toggle(false);
    else if (["ArrowDown", "ArrowUp"].includes(event.key)) {
      event.preventDefault();
      if (!open) toggle(true);
      else highlight(step(active, event.key === "ArrowDown" ? 1 : -1));
    } else if (open && ["Home", "End"].includes(event.key)) {
      event.preventDefault();
      highlight(event.key === "Home" ? step(-1, 1) : step(items.length, -1));
    } else if (open && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      choose(items[active]);
    }
  });
  Object.defineProperties(root, {
    value: {
      get: () => current,
      set: (next) => {
        current = String(next ?? "");
        field.value = current;
        paint();
      },
    },
    setOptions: {
      value: (next) => {
        items = next;
        paint();
      },
    },
    setDisabled: {
      value: (flag) => {
        trigger.disabled = !!flag;
        if (flag) toggle(false);
      },
    },
  });
  paint();
  return root;
}
