const { PerformanceCalculator } = require("./PerformanceCalculator");

let hasLoggedCalculationError = false;

function isPerformanceScoringEnabled() {
  return Boolean(process.env.ENABLE_PERFORMANCE_SCORING);
}

function logCalculationErrorOnce(error) {
  if (hasLoggedCalculationError) {
    return;
  }

  hasLoggedCalculationError = true;
  console.warn("[PerformanceScoring] Calculation failed, returning null.", error?.message || error);
}

/**
 * Optional, side-effect-free entrypoint for future integration.
 * Returns `null` when the feature flag is disabled.
 *
 * @param {import('./performance.types').PerformanceInput=} data
 * @returns {import('./performance.types').PerformanceResult | null}
 */
function calculatePerformance(data) {
  if (!isPerformanceScoringEnabled()) {
    return null;
  }

  try {
    const calculator = new PerformanceCalculator();
    return calculator.calculate(data);
  } catch (error) {
    logCalculationErrorOnce(error);
    return null;
  }
}

module.exports = {
  calculatePerformance,
  isPerformanceScoringEnabled,
};
