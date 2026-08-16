/**
 * Auth screens load almost nothing: no Bootstrap, no Alpine, no charts. Just the
 * OTP box behaviour and a submit lock, because a double-submitted magic link is
 * the most common way people lock themselves out.
 */
const otp = document.querySelector("[data-otp]");
if (otp) {
  const inputs = [...otp.querySelectorAll("input")];

  inputs.forEach((input, i) => {
    input.addEventListener("input", () => {
      input.value = input.value.replace(/\D/g, "").slice(-1);
      if (input.value && i < inputs.length - 1) inputs[i + 1].focus();
      const code = inputs.map((x) => x.value).join("");
      if (code.length === inputs.length) otp.closest("form")?.requestSubmit();
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && !input.value && i > 0) inputs[i - 1].focus();
    });
  });

  // Paste the whole code into any box.
  otp.addEventListener("paste", (e) => {
    const digits = (e.clipboardData?.getData("text") || "").replace(/\D/g, "").slice(0, inputs.length);
    if (!digits) return;
    e.preventDefault();
    digits.split("").forEach((d, i) => { if (inputs[i]) inputs[i].value = d; });
    if (digits.length === inputs.length) otp.closest("form")?.requestSubmit();
  });
}

document.querySelectorAll("form[data-lock]").forEach((form) => {
  form.addEventListener("submit", () => {
    const button = form.querySelector("button[type='submit']");
    if (!button) return;
    button.disabled = true;
    button.dataset.label = button.textContent;
    button.textContent = button.dataset.busy || "Working…";
  });
});

// Resend cooldown: 30s, visible, so nobody hammers the button.
const resend = document.querySelector("[data-resend]");
if (resend) {
  let left = 30;
  const label = resend.textContent;
  resend.disabled = true;
  const tick = setInterval(() => {
    left -= 1;
    resend.textContent = `${label} (${left}s)`;
    if (left <= 0) {
      clearInterval(tick);
      resend.disabled = false;
      resend.textContent = label;
    }
  }, 1000);
}
