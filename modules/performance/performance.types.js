/**
 * @typedef {Object} PerformanceScreenshotInput
 * @property {boolean=} isWorkRelated
 * @property {number=} confidence
 *
 * @typedef {Object} PerformanceInput
 * @property {string=} userId
 * @property {number=} activityPercent
 * @property {number=} productiveTime
 * @property {number=} unproductiveTime
 * @property {number=} totalTime
 * @property {number=} tasksCompleted
 * @property {number=} expectedTasks
 * @property {number=} idleTime
 * @property {PerformanceScreenshotInput[]=} screenshots
 *
 * @typedef {Object} PerformanceScores
 * @property {number} activity
 * @property {number} productivity
 * @property {number} output
 * @property {number} consistency
 * @property {number} screenshot
 *
 * @typedef {"Needs Improvement"|"Fair"|"Good"|"Excellent"} PerformanceRating
 *
 * @typedef {Object} PerformanceResult
 * @property {string} userId
 * @property {PerformanceScores} scores
 * @property {number} finalScore
 * @property {PerformanceRating} rating
 */

module.exports = {};
