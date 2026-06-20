/**
 * @typedef {import('./performance.types').PerformanceInput} PerformanceInput
 * @typedef {import('./performance.types').PerformanceResult} PerformanceResult
 */

const DEFAULT_SCORE = 50;
const SAFE_WEIGHTS = Object.freeze({
  activity: 0.25,
  productivity: 0.20,
  output: 0.25,
  consistency: 0.15,
  screenshot: 0.15,
});

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampScore(value) {
  const number = toFiniteNumber(value);
  if (number === null) {
    return DEFAULT_SCORE;
  }

  if (number < 0) {
    return 0;
  }

  if (number > 100) {
    return 100;
  }

  return Number(number.toFixed(2));
}

function getSafeTimeValue(value) {
  const number = toFiniteNumber(value);
  if (number === null) {
    return null;
  }

  return Math.max(0, number);
}

function calculateActivityScore(input) {
  return clampScore(input.activityPercent);
}

function calculateProductivityScore(input) {
  const productiveTime = getSafeTimeValue(input.productiveTime);
  const unproductiveTime = getSafeTimeValue(input.unproductiveTime);
  const totalTime = getSafeTimeValue(input.totalTime);

  if (productiveTime === null || unproductiveTime === null || totalTime === null || totalTime <= 0) {
    return DEFAULT_SCORE;
  }

  return clampScore(((productiveTime - unproductiveTime) / totalTime) * 100);
}

function calculateOutputScore(input) {
  const tasksCompleted = getSafeTimeValue(input.tasksCompleted);
  const expectedTasks = getSafeTimeValue(input.expectedTasks);

  if (tasksCompleted === null || expectedTasks === null || expectedTasks <= 0) {
    return DEFAULT_SCORE;
  }

  return clampScore((tasksCompleted / expectedTasks) * 100);
}

function calculateConsistencyScore(input) {
  const idleTime = getSafeTimeValue(input.idleTime);
  const totalTime = getSafeTimeValue(input.totalTime);

  if (idleTime === null || totalTime === null || totalTime <= 0) {
    return DEFAULT_SCORE;
  }

  return clampScore(100 - ((idleTime / totalTime) * 100));
}

function calculateScreenshotScore(input) {
  if (!Array.isArray(input.screenshots) || input.screenshots.length === 0) {
    return DEFAULT_SCORE;
  }

  const weightedTotals = input.screenshots.reduce(
    (totals, screenshot) => {
      const normalizedConfidence = clampScore(
        toFiniteNumber(screenshot?.confidence) === null ? 100 : Number(screenshot.confidence)
      ) / 100;
      const relatedWeight = screenshot?.isWorkRelated === false ? 0 : 1;

      totals.confidence += normalizedConfidence;
      totals.score += relatedWeight * normalizedConfidence;
      return totals;
    },
    { score: 0, confidence: 0 }
  );

  if (weightedTotals.confidence <= 0) {
    return DEFAULT_SCORE;
  }

  return clampScore((weightedTotals.score / weightedTotals.confidence) * 100);
}

function getRating(score) {
  if (score >= 85) {
    return "Excellent";
  }

  if (score >= 70) {
    return "Good";
  }

  if (score >= 50) {
    return "Fair";
  }

  return "Needs Improvement";
}

class PerformanceCalculator {
  /**
   * @param {PerformanceInput=} input
   * @returns {PerformanceResult}
   */
  calculate(input = {}) {
    const normalizedInput = input && typeof input === "object" ? input : {};
    const scores = {
      activity: calculateActivityScore(normalizedInput),
      productivity: calculateProductivityScore(normalizedInput),
      output: calculateOutputScore(normalizedInput),
      consistency: calculateConsistencyScore(normalizedInput),
      screenshot: calculateScreenshotScore(normalizedInput),
    };

    const finalScore = clampScore(
      (scores.activity * SAFE_WEIGHTS.activity) +
      (scores.productivity * SAFE_WEIGHTS.productivity) +
      (scores.output * SAFE_WEIGHTS.output) +
      (scores.consistency * SAFE_WEIGHTS.consistency) +
      (scores.screenshot * SAFE_WEIGHTS.screenshot)
    );

    return {
      userId: String(normalizedInput.userId || "").trim(),
      scores,
      finalScore,
      rating: getRating(finalScore),
    };
  }
}

module.exports = {
  DEFAULT_SCORE,
  SAFE_WEIGHTS,
  PerformanceCalculator,
  clampScore,
};
