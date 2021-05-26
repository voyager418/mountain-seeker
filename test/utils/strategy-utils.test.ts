import { StrategyUtils } from "../../src/utils/strategy-utils";

describe("Strategy utils", () => {
    describe("getPercentVariation", () => {
        test("Should correctly compute percent change between 2 numbers", () => {
            expect(StrategyUtils.getPercentVariation(-5, -2.5)).toBe(50);
        });

        test("Should correctly compute percent change between 2 numbers", () => {
            expect(StrategyUtils.getPercentVariation(5, -10)).toBe(-300);
        });

        test("Should correctly compute percent change between 2 numbers", () => {
            expect(StrategyUtils.getPercentVariation(-10, 5)).toBe(150);
        });

        test("Should correctly compute percent change between 2 numbers", () => {
            expect(StrategyUtils.getPercentVariation(-10, -5)).toBe(50);
        });

        test("Should correctly compute positive percent change between 2 numbers", () => {
            expect(StrategyUtils.getPercentVariation(2.5, 5)).toBe(100);
        });

        test("Should correctly compute negative percent change between 2 numbers", () => {
            expect(StrategyUtils.getPercentVariation(5, 2.5)).toBe(-50);
        });

        test("Should return 0 if 2 numbers are the same", () => {
            expect(StrategyUtils.getPercentVariation(5, 5)).toBe(0);
        });
    });
});