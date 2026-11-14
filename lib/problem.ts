export const problem = {
  title: "Two Sum",
  functionName: "two_sum",
  statement: `Given an array of integers nums and an integer target, return the indices of the two numbers that add up to target.`,
  examples: [
    { input: "nums = [2, 7, 11, 15], target = 9", output: "[0, 1]", note: "nums[0] + nums[1] = 2 + 7 = 9" },
    { input: "nums = [3, 2, 4], target = 6", output: "[1, 2]" },
  ],
  starterCode: `def two_sum(nums, target):
    pass
`,
  // [nums, target, expected indices]
  tests: [
    [[2, 7, 11, 15], 9, [0, 1]],
    [[3, 2, 4], 6, [1, 2]],
    [[3, 3], 6, [0, 1]],
    [[-1, -2, -3, -4, -5], -8, [2, 4]],
    [[0, 4, 3, 0], 0, [0, 3]],
  ] as [number[], number, number[]][],

  intro:
    "Hi, thanks for joining. The problem is on your left. Given an array of integers and a target, return the indices of the two numbers that add up to the target. Take a moment to read it, ask me anything you want clarified, and talk me through your thinking as you work.",

  // Only the interviewer sees this. The statement is deliberately underspecified
  // so the candidate has something to clarify.
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
};
