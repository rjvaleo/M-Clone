async function runValidationSuite() {
  const iframe = document.getElementById("appFrame");
  const resultsEl = document.getElementById("results");
  const summaryEl = document.getElementById("summary");

  function addResult(name, pass, details) {
    const row = document.createElement("li");
    row.className = pass ? "pass" : "fail";
    row.textContent = (pass ? "PASS: " : "FAIL: ") + name + (details ? " - " + details : "");
    resultsEl.appendChild(row);
    return pass;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error("Timed out loading app iframe")), 10000);
    iframe.onload = () => {
      clearTimeout(to);
      resolve();
    };
    iframe.src = "../index.html";
  });

  const win = iframe.contentWindow;
  const doc = iframe.contentDocument;

  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total += 1;
    return Promise.resolve()
      .then(fn)
      .then((details) => {
        if (addResult(name, true, details || "")) passed += 1;
      })
      .catch((err) => {
        addResult(name, false, err && err.message ? err.message : String(err));
      });
  }

  await test("UI renders only LFO 1 and LFO 2", () => {
    const labels = Array.from(doc.querySelectorAll(".row-label"))
      .map((el) => (el.textContent || "").trim())
      .filter((t) => t.startsWith("LFO"));
    if (labels.length !== 2 || labels[0] !== "LFO 1" || labels[1] !== "LFO 2") {
      throw new Error("Expected [LFO 1, LFO 2], got [" + labels.join(", ") + "]");
    }
    if (doc.getElementById("lfo3Canvas") || doc.getElementById("lfo4Canvas")) {
      throw new Error("Found removed LFO 3/4 canvases");
    }
    return "Labels: " + labels.join(", ");
  });

  await test("Filter debug box has fixed size", () => {
    const box = doc.getElementById("filterDebugVal");
    if (!box) throw new Error("Missing filter debug box");
    const style = win.getComputedStyle(box);
    if (style.width !== "148px" || style.height !== "56px") {
      throw new Error("Expected 148x56px, got " + style.width + " x " + style.height);
    }
    return style.width + " x " + style.height;
  });

  await test("Metronome toggle updates state and button", () => {
    const btn = doc.getElementById("metroBtn");
    if (!btn) throw new Error("Missing metronome button");
    const startText = (btn.textContent || "").trim();
    const startActive = btn.classList.contains("active");
    btn.click();
    const onText = (btn.textContent || "").trim();
    const onActive = btn.classList.contains("active");
    btn.click();
    const offText = (btn.textContent || "").trim();
    const offActive = btn.classList.contains("active");
    if (startText !== "CLICK OFF" || onText !== "CLICK ON" || offText !== "CLICK OFF") {
      throw new Error("Unexpected button texts: " + [startText, onText, offText].join(" -> "));
    }
    if (startActive || !onActive || offActive) {
      throw new Error("Unexpected metronome active-state transition");
    }
    return "State toggled correctly";
  });

  await test("Transport counter advances on rest steps", async () => {
    const pos = doc.getElementById("posDisplay");
    const play = doc.getElementById("playBtn");
    if (!pos || !play) throw new Error("Missing transport elements");

    win.updateSteps("8");
    win.updateBPM("120");
    doc.getElementById("stepsSlider").value = "8";
    doc.getElementById("bpmSlider").value = "120";

    for (let i = 0; i < 8; i++) {
      if (win.steps && win.steps[i]) win.steps[i].rest = i % 2 === 1;
    }
    if (typeof win.renderStepGrid === "function") win.renderStepGrid();

    const seen = [];
    let last = (pos.textContent || "").trim();
    seen.push(last);

    const obs = new MutationObserver(() => {
      const v = (pos.textContent || "").trim();
      if (v !== last) {
        last = v;
        seen.push(v);
      }
    });
    obs.observe(pos, { childList: true, subtree: true, characterData: true });

    play.click();
    await wait(2400);
    play.click();
    obs.disconnect();

    const expected = ["1", "2", "3", "4", "5"];
    const hasExpectedRun = expected.every((v) => seen.includes(v));
    if (!hasExpectedRun) {
      throw new Error("Counter sequence missing expected values. Seen: " + seen.join(" | "));
    }
    return "Observed " + seen.length + " counter transitions";
  });

  summaryEl.textContent = "Validation suite: " + passed + "/" + total + " passed";
  summaryEl.className = passed === total ? "summary ok" : "summary bad";

  window.validationResults = { passed, total };
}

document.addEventListener("DOMContentLoaded", () => {
  runValidationSuite().catch((err) => {
    const summaryEl = document.getElementById("summary");
    summaryEl.textContent = "Validation suite crashed: " + (err.message || String(err));
    summaryEl.className = "summary bad";
    window.validationResults = { passed: 0, total: 1 };
  });
});
