import { h, link, button, submit, field, form, icon } from "../core/dom.js";
const brand = () =>
  link(
    [
      h("img", { src: "/ui/brand/logo.svg", width: 32, height: 32, alt: "" }),
      h("strong", {}, "strckro", h("i", {}, ".")),
    ],
    "/",
    "brand",
  );
export async function login({ root, api, session, onSuccess }) {
  const bootstrap = session.bootstrapRequired;
  const title = bootstrap ? "Create your workspace." : "Welcome back.";
  const email = field("อีเมล", "email", {
    type: "email",
    required: true,
    autocomplete: "username",
    maxLength: 254,
  });
  const password = field(bootstrap ? "รหัสผ่านใหม่" : "รหัสผ่าน", "password", {
    type: "password",
    required: true,
    minLength: 12,
    maxLength: 128,
    autocomplete: bootstrap ? "new-password" : "current-password",
    hint: bootstrap
      ? "อย่างน้อย 12 ตัว มีตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และสัญลักษณ์"
      : undefined,
  });
  const confirmation = bootstrap
    ? field("ยืนยันรหัสผ่าน", "confirmation", {
        type: "password",
        required: true,
        minLength: 12,
        maxLength: 128,
        autocomplete: "new-password",
      })
    : null;
  const current =
    bootstrap && session.bootstrapRequiresInstallerPassword
      ? field("รหัสผ่านจากตัวติดตั้ง", "currentPassword", {
          type: "password",
          required: true,
          autocomplete: "current-password",
        })
      : null;
  const f = form(
    async (values) => {
      if (bootstrap && values.password !== values.confirmation)
        throw new Error("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      await api.post(bootstrap ? "/api/bootstrap" : "/api/login", {
        email: values.email,
        password: values.password,
        ...(bootstrap ? { confirmPassword: values.confirmation } : {}),
        ...(current ? { currentPassword: values.currentPassword } : {}),
      });
      password.control.value = "";
      if (confirmation) confirmation.control.value = "";
      if (current) current.control.value = "";
      await onSuccess();
    },
    email,
    current,
    password,
    confirmation,
    submit(bootstrap ? "สร้างบัญชีเจ้าของระบบ" : "เข้าสู่ workspace →"),
  );
  root.replaceChildren(
    h(
      "section",
      { class: "auth" },
      h(
        "aside",
        { class: "auth-intro" },
        brand(),
        h(
          "div",
          { class: "auth-copy" },
          h(
            "span",
            { class: "overline" },
            "FROM YOUR FIRST COMMIT TO YOUR NEXT RELEASE",
          ),
          h(
            "h1",
            {},
            "Less waiting.",
            h("br"),
            "More ",
            h("em", {}, "shipping."),
          ),
          h(
            "p",
            {},
            "ดูแลแอป source และทุก release จาก workspace ที่เป็นของคุณ เรียบง่าย พร้อมทำงาน และเข้าถึงได้จาก CLI",
          ),
        ),
        h("img", {
          class: "auth-art",
          src: "/ui/brand/hero-track.svg",
          width: 760,
          height: 214,
          alt: "",
        }),
        h(
          "footer",
          {},
          h("span", {}, "Your infrastructure. Your rules."),
          h("span", {}, "Strckro"),
        ),
      ),
      h(
        "div",
        { class: "auth-content" },
        h(
          "div",
          { class: "auth-box" },
          h(
            "span",
            { class: "overline" },
            bootstrap ? "FIRST-RUN SETUP" : "SIGN IN TO STRCKRO",
          ),
          h("h1", {}, title),
          h(
            "p",
            {},
            bootstrap
              ? "สร้างบัญชีเจ้าของครั้งแรกเพื่อเริ่มดูแลโฮสต์นี้"
              : "เข้าสู่ระบบเพื่อทำงานต่อกับแอปและโครงสร้างพื้นฐานของคุณ",
          ),
          f,
          h(
            "div",
            { class: "auth-foot" },
            "SELF-HOSTED / DEPLOYMENT WORKSPACE",
          ),
        ),
      ),
    ),
  );
  email.control.focus();
}
export async function invitation({ root, api }) {
  const url = new URL(location.href);
  const token = url.searchParams.get("token") || "";
  url.searchParams.delete("token");
  history.replaceState(history.state, "", url);
  const status = h("p", { role: "status", class: "notice", hidden: true });
  const password = field("รหัสผ่านใหม่", "password", {
    type: "password",
    minLength: 12,
    maxLength: 128,
    required: true,
    autocomplete: "new-password",
    hint: "ใช้ตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และสัญลักษณ์",
  });
  const confirmation = field("ยืนยันรหัสผ่าน", "passwordConfirmation", {
    type: "password",
    minLength: 12,
    maxLength: 128,
    required: true,
    autocomplete: "new-password",
  });
  const f = form(
    async (v) => {
      if (v.password !== v.passwordConfirmation)
        throw new Error("รหัสผ่านทั้งสองช่องไม่ตรงกัน");
      await api.post("/api/invitations/accept", { token, ...v });
      password.control.value = confirmation.control.value = "";
      f.hidden = true;
      status.hidden = false;
      status.textContent =
        "เปิดใช้งานบัญชีแล้ว เข้าสู่ระบบด้วยอีเมลและรหัสผ่านใหม่ได้เลย";
    },
    password,
    confirmation,
    submit("เปิดใช้งานบัญชี"),
  );
  if (!token) {
    f.hidden = true;
    status.hidden = false;
    status.textContent = "ลิงก์คำเชิญไม่ถูกต้องหรือไม่มี token";
  }
  root.replaceChildren(
    h(
      "section",
      { class: "auth-single" },
      h(
        "div",
        { class: "auth-box" },
        brand(),
        h("span", { class: "overline" }, "YOU’RE INVITED"),
        h("h1", {}, "Join the workspace."),
        h(
          "p",
          { class: "muted" },
          "ตั้งรหัสผ่านเพื่อเปิดใช้งานบัญชีที่ได้รับคำเชิญ",
        ),
        f,
        status,
        link("กลับไปเข้าสู่ระบบ →", "/", "btn ghost"),
      ),
    ),
  );
}
export async function mount(ctx) {
  return invitation(ctx);
}
