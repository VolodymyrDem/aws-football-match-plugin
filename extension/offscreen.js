// The challenge chime (1.28): three rising notes, played from this hidden page because a service
// worker cannot play sound. background.js opens it and sends {type: "chime"}.
chrome.runtime.onMessage.addListener(msg => {
  if (!msg || msg.type !== "chime") return;
  const ac = new AudioContext();
  [659, 880, 1175].forEach((f, i) => {
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime + i * 0.18;
    o.type = "triangle"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.4);
  });
  setTimeout(() => ac.close(), 1500);
});
