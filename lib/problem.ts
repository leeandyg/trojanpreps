import { BRAND } from "./brand";
import type { Problem } from "./types";

// The opening line is the same for every problem apart from the one-sentence summary of the task.
const intro = (task: string) =>
  `Hi, I'm ${BRAND.interviewer}. Thanks for joining, it's good to meet you. We'll work through one problem together, and I'm mostly interested in how you think, so there's no need to rush. The problem is on your left: ${task} Take a moment to read it, and talk me through your thinking as you go. Anything you want to ask before you start?`;

// Each statement is deliberately underspecified so the candidate has something to clarify;
// the answers are in interviewerNotes, which only the interviewer sees.
const twoSum: Problem = {
  id: "two-sum",
  title: "Two Sum",
  functionName: "two_sum",
  params: ["nums", "target"],
  statement: `Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target.`,
  examples: [
    { input: "nums = [2, 7, 11, 15], target = 9", output: "[0, 1]", note: "nums[0] + nums[1] = 2 + 7 = 9" },
    { input: "nums = [3, 2, 4], target = 6", output: "[1, 2]" },
  ],
  starterCode: `def two_sum(nums, target):
    pass
`,
  tests: [
    { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
    { args: [[3, 2, 4], 6], expected: [1, 2] },
    { args: [[3, 3], 6], expected: [0, 1] },
    { args: [[-1, -2, -3, -4, -5], -8], expected: [2, 4] },
    { args: [[0, 4, 3, 0], 0], expected: [0, 3] },
  ],
  anyOrder: true,

  intro: intro(
    "given an array of integers and a target, return the indices of the two numbers that add up to the target."
  ),

  interviewerNotes: `Facts to give ONLY when the candidate asks:
- Exactly one valid pair exists for every input. No need to handle "no solution".
- The same element cannot be used twice, but two different elements may have the same value (e.g. [3, 3], target 6 -> [0, 1]).
- Values can be negative or zero. The array is not sorted.
- Return the two indices in any order.
- Length is 2 up to about 10^4. Extra memory is fine.

Reference solution: one pass with a hash map from value -> index. For each number, look up target - num in the map first; if present, return both indices; otherwise store the current number. O(n) time, O(n) space.

Decisions worth hearing the candidate explain:
- Why a hash map at all (constant-time complement lookup instead of the O(n^2) nested loop).
- What the map stores: value as key, index as value, and why (we must return indices).
- Why the lookup happens BEFORE the insert (otherwise an element can pair with itself, e.g. [3, 2, 4] target 6 would match 3 with itself; and it is what makes [3, 3] work with a single map).
- One pass vs two passes.
- Time/space tradeoff against brute force, or against sort + two pointers (O(n log n), loses original indices).
- Edge cases: duplicates [3, 3], negatives, zeros [0, 4, 3, 0] target 0.`,

  edgeCases: "duplicates, negatives, same element twice, no solution",
  alternatives: "brute force, sorting",
  announced: `"I'll use a dictionary" or "I'll use a hash map to store the numbers"`,
  explained: `"A dictionary gives me constant-time lookup of the complement"`,
};

const validParentheses: Problem = {
  id: "valid-parentheses",
  title: "Valid Parentheses",
  functionName: "is_valid",
  params: ["s"],
  statement: `Given a string s of brackets, return whether it is valid: every opening bracket is closed by a matching bracket, in the right order.`,
  examples: [
    { input: "s = '()[]{}'", output: "True" },
    { input: "s = '(]'", output: "False", note: "'(' is closed by the wrong kind of bracket" },
  ],
  starterCode: `def is_valid(s):
    pass
`,
  tests: [
    { args: ["()[]{}"], expected: true },
    { args: ["(]"], expected: false },
    { args: ["{[]}"], expected: true },
    { args: ["([)]"], expected: false },
    { args: [""], expected: true },
    { args: ["(("], expected: false },
    { args: ["]"], expected: false },
  ],

  intro: intro(
    "given a string of brackets, decide whether it's valid, meaning every opening bracket gets closed by a matching one, in the right order."
  ),

  interviewerNotes: `Facts to give ONLY when the candidate asks:
- There are three kinds of bracket: round ( ), square [ ] and curly { }. The string contains only those six characters: no letters, digits or spaces.
- "In the right order" means properly nested: the most recently opened bracket must be the first one closed. So "{[]}" is valid and "([)]" is not, even though each kind is balanced in it.
- A closing bracket with no opening bracket before it makes the string invalid, and so does an opening bracket that is never closed.
- The empty string is valid.
- Return a boolean (True or False).
- Length is 0 up to about 10^4. Extra memory is fine.

Reference solution: one pass with a stack, plus a small map from each closing bracket to its opening bracket. For each character: if it is an opening bracket, push it. Otherwise it is a closing bracket: if the stack is empty, or the top of the stack is not the matching opening bracket, return False; otherwise pop. After the loop, return whether the stack is empty. O(n) time, O(n) space in the worst case (a string of only opening brackets).

Decisions worth hearing the candidate explain:
- Why a stack at all: the most recently opened bracket must be closed first, which is last-in first-out.
- Why counting is not enough: one counter per bracket kind accepts "([)]", because counts ignore the order of nesting. (With a single kind of bracket a counter would do; it is the mix of kinds that needs the stack.)
- What the map stores and why: closing bracket as key, opening bracket as value, so one lookup says both "this is a closing bracket" and "this is what must be on top". The mirror image (push the expected closing bracket when an opening one is seen, then compare directly) is equally good; a chain of if statements works but is the thing to ask about.
- Why the stack is checked for being empty BEFORE looking at or popping the top on a closing bracket: otherwise "]" raises an error instead of returning False.
- Why the final return checks that the stack is empty rather than returning True: otherwise "((" is accepted.
- Returning False at the first mismatch instead of scanning on.
- An early return for odd length is a fine shortcut, but it does not change the complexity and does not replace any of the checks above.
- Time and space: O(n) and O(n); against repeatedly deleting adjacent "()", "[]", "{}" pairs until nothing changes, which is correct but O(n^2).
- Edge cases: empty string, a closing bracket first "]", opening brackets left over "((", interleaved kinds "([)]", nesting "{[]}".`,

  edgeCases:
    "empty string, a closing bracket with nothing open, opening brackets left unclosed, different kinds interleaved",
  alternatives: "one counter per bracket kind, repeatedly removing adjacent pairs",
  announced: `"I'll use a stack" or "I'll push the opening brackets onto a list"`,
  explained: `"A stack fits because the last bracket I opened has to be the first one closed"`,
};

const buySellStock: Problem = {
  id: "best-time-to-buy-and-sell-stock",
  title: "Best Time to Buy and Sell Stock",
  functionName: "max_profit",
  params: ["prices"],
  statement: `Given an array prices where prices[i] is the price of a stock on day i, return the maximum profit you can make by buying once and selling once.`,
  examples: [
    { input: "prices = [7, 1, 5, 3, 6, 4]", output: "5", note: "buy on day 1 at 1, sell on day 4 at 6" },
    { input: "prices = [2, 4, 1]", output: "2" },
  ],
  starterCode: `def max_profit(prices):
    pass
`,
  tests: [
    { args: [[7, 1, 5, 3, 6, 4]], expected: 5 },
    { args: [[7, 6, 4, 3, 1]], expected: 0 },
    { args: [[2, 4, 1]], expected: 2 },
    { args: [[3, 8, 1, 2]], expected: 5 },
    { args: [[5]], expected: 0 },
    { args: [[3, 3, 3]], expected: 0 },
  ],

  intro: intro(
    "given a list of a stock's price on each day, return the most profit you could make by buying once and selling once."
  ),

  interviewerNotes: `Facts to give ONLY when the candidate asks:
- One transaction only: buy one share on one day, sell it on a later day. You must buy before you sell; no short selling.
- If no profit is possible (the price never rises after any day), return 0. Not trading is allowed, so the answer is never negative.
- Return only the profit, an integer, not the days.
- Days are numbered from 0. The array is in time order and is not sorted by price.
- Prices are non-negative integers and may repeat. Length is 1 up to about 10^5; a single day gives 0.

Reference solution: one pass that keeps two numbers, the lowest price seen so far and the best profit seen so far (starting at 0). For each price, the profit from selling today is the price minus the lowest price so far; keep the larger of that and the best so far, and update the lowest price. Return the best profit. O(n) time, O(1) space.

Decisions worth hearing the candidate explain:
- Why the lowest price SO FAR rather than the lowest price in the whole array: the buy must come before the sell, and the overall minimum can come after the best day to sell. [3, 8, 1, 2] gives 5, not 8 - 1 = 7 and not 2 - 1 = 1.
- Why one pass is enough: for any selling day the best buying day is simply the cheapest earlier day, so a running minimum carries everything the earlier days have to offer; there is no need to remember which day it was or to look back.
- Why the best profit starts at 0: it covers falling prices and a single day without a special case, and matches "not trading is allowed".
- Order inside the loop: whether the profit is computed before or after the minimum is updated. Either is correct, because buying and selling on the same day gives 0 and can never raise the answer; worth hearing that they know why.
- What the running minimum starts as (the first price, or infinity) and what that means for a one-element array.
- Time/space tradeoff against brute force over every buy day and sell day, O(n^2) time. Sorting is not an option because it destroys the order of the days. Taking the maximum of everything to the right of each day is correct but needs O(n) extra space or a backward pass.
- Edge cases: prices that only fall [7, 6, 4, 3, 1] -> 0, a single day, all prices equal, the lowest price after the highest.`,

  edgeCases:
    "prices that only fall so there is no profit, a single day, the lowest price coming after the best day to sell, equal prices",
  alternatives: "brute force over every pair of days, the overall minimum and maximum",
  announced: `"I'll keep track of the minimum" or "I'll use a variable for the lowest price"`,
  explained: `"I only need the lowest price so far, because the buy has to come before the sell"`,
};

// The first one is the default.
export const PROBLEMS: Problem[] = [twoSum, validParentheses, buySellStock];
export const DEFAULT_PROBLEM = twoSum;

// Unknown or missing ids fall back to the default, so a stale client cannot break a route.
export const getProblem = (id?: unknown): Problem => PROBLEMS.find((p) => p.id === id) || DEFAULT_PROBLEM;
