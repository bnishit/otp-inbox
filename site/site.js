const picker = document.querySelector("#guide-picker");
const source = document.querySelector("#source");
const notes = {
  iphone: "iPhone: generated Shortcut + personal Message automation.",
  android: "Android: Tasker recipe. Physical-device testing still needed.",
  "gmail-polling":
    "Gmail: private Apps Script collector, one setup per mailbox.",
  "gmail-push":
    "Gmail: your Google Cloud project + authenticated push, with minute polling kept as backup.",
};
source.addEventListener("change", () => {
  document.querySelector("#guide-note").textContent = notes[source.value];
});
picker.addEventListener("submit", (event) => {
  event.preventDefault();
  if (Object.hasOwn(notes, source.value))
    window.location.href =
      "https://github.com/bnishit/otp-inbox/blob/feat/automatic-site-fill/docs/" +
      source.value +
      ".md";
});

const copySetup = document.querySelector("#copy-setup");
const setupPrompt = document.querySelector("#setup-prompt");
const copyStatus = document.querySelector("#copy-status");
copySetup.addEventListener("click", async () => {
  copySetup.disabled = true;
  try {
    await navigator.clipboard.writeText(setupPrompt.value);
    copyStatus.textContent = "Copied. Paste into Codex or Claude Code to start.";
  } catch {
    document.querySelector("#prompt-details").open = true;
    setupPrompt.focus();
    setupPrompt.select();
    copyStatus.textContent = "Clipboard access is blocked. The full prompt is selected; copy it manually.";
  } finally {
    copySetup.disabled = false;
  }
});
