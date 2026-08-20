import { mountNav, onPageCleanup, providerStrip } from "/js/shared.js";

mountNav();
providerStrip("#landing-strip");

const hero = document.querySelector(".home-hero");
const image = document.querySelector("#home-console-image");
const live = document.querySelector("#home-console-live");
const controls = document.querySelector(".home-hero-proof");
const stateButtons = [...document.querySelectorAll("button[data-console-state]")];
const toggle = document.querySelector(".home-state-toggle");

const states = [
  {
    key: "blocked",
    label: "BLOCKED",
    detail: "mandate violation",
    src: "/assets/circuit-mandate-console.png",
    alt: "A white CIRCUIT mandate console showing a blocked execution state",
  },
  {
    key: "allow",
    label: "ALLOW",
    detail: "inside mandate",
    src: "/assets/circuit-mandate-console-allow.png",
    alt: "A white CIRCUIT mandate console showing an allowed execution state in green",
  },
  {
    key: "stale",
    label: "STALE",
    detail: "approval expired",
    src: "/assets/circuit-mandate-console-stale.png",
    alt: "A white CIRCUIT mandate console showing a stale approval state in gray",
  },
];

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let activeIndex = 0;
let timer = null;
let pausedByUser = false;
let interactionPaused = false;

function stopTimer() {
  if (timer !== null) window.clearTimeout(timer);
  timer = null;
}

function renderState(index) {
  activeIndex = (index + states.length) % states.length;
  const state = states[activeIndex];
  hero.dataset.consoleState = state.key;
  image.src = state.src;
  image.alt = state.alt;
  live.textContent = `${state.label} · ${state.detail}`;
  stateButtons.forEach((button, buttonIndex) => {
    button.setAttribute("aria-pressed", String(buttonIndex === activeIndex));
  });
}

function scheduleNext() {
  stopTimer();
  if (reducedMotion.matches || pausedByUser || interactionPaused || document.hidden) return;
  timer = window.setTimeout(() => {
    renderState(activeIndex + 1);
    scheduleNext();
  }, 3200);
}

function setInteractionPaused(value) {
  interactionPaused = value;
  scheduleNext();
}

stateButtons.forEach((button) => {
  button.addEventListener("click", () => {
    renderState(Number(button.dataset.consoleState));
    scheduleNext();
  });
});

toggle.addEventListener("click", () => {
  pausedByUser = !pausedByUser;
  toggle.textContent = pausedByUser ? "PLAY" : "PAUSE";
  toggle.setAttribute("aria-label", `${pausedByUser ? "Play" : "Pause"} console state slideshow`);
  scheduleNext();
});

controls.addEventListener("pointerenter", () => setInteractionPaused(true));
controls.addEventListener("pointerleave", () => setInteractionPaused(false));
controls.addEventListener("focusin", () => setInteractionPaused(true));
controls.addEventListener("focusout", (event) => {
  if (!controls.contains(event.relatedTarget)) setInteractionPaused(false);
});
const handleVisibilityChange = () => scheduleNext();
const handleReducedMotionChange = () => scheduleNext();
document.addEventListener("visibilitychange", handleVisibilityChange);
reducedMotion.addEventListener("change", handleReducedMotionChange);
onPageCleanup(() => {
  stopTimer();
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  reducedMotion.removeEventListener("change", handleReducedMotionChange);
});

renderState(0);
Promise.all(states.slice(1).map(({ src }) => {
  const preload = new Image();
  preload.src = src;
  return preload.decode().catch(() => undefined);
})).finally(scheduleNext);
