// Local simulation + snapshot timings; excludes browser rendering and DOM work.
const {performance} = require('node:perf_hooks');
const {Simulation, LAYOUTS, DT} = require('../src/physics.js');
const report = [];
for (const layout of Object.keys(LAYOUTS)) {
  const simulation = new Simulation(layout), samples = [];
  simulation.push('chest', 15, 0.8);
  while (simulation.active) {
    const start = performance.now();
    simulation.step();
    simulation.snapshot();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const total = samples.reduce((sum, value) => sum + value, 0);
  report.push({
    layout,
    ticks: samples.length,
    meanMs: +(total / samples.length).toFixed(3),
    p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(3),
    maxMs: +samples.at(-1).toFixed(3),
    totalSeconds: +(total / 1000).toFixed(2),
    simulatedSeconds: +simulation.time.toFixed(2),
    tickBudgetMs: +(DT * 1000).toFixed(2)
  });
}
console.log(JSON.stringify(report, null, 2));
