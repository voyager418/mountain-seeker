import { NumberUtils } from "../../src/utils/number-utils";

describe("Number utils", () => {
    describe("getPercentVariation", () => {
        test("Should correctly compute percent change between 2 numbers", () => {
            expect(NumberUtils.getPercentVariation(-5, -2.5)).toBe(50);
        });

        test("Should correctly compute percent change between 2 numbers", () => {
            expect(NumberUtils.getPercentVariation(5, -10)).toBe(-300);
        });

        test("Should correctly compute percent change between 2 numbers", () => {
            expect(NumberUtils.getPercentVariation(-10, 5)).toBe(150);
        });

        test("Should correctly compute percent change between 2 numbers", () => {
            expect(NumberUtils.getPercentVariation(-10, -5)).toBe(50);
        });

        test("Should correctly compute positive percent change between 2 numbers", () => {
            expect(NumberUtils.getPercentVariation(2.5, 5)).toBe(100);
        });

        test("Should correctly compute negative percent change between 2 numbers", () => {
            expect(NumberUtils.getPercentVariation(5, 2.5)).toBe(-50);
        });

        test("Should return 0 if 2 numbers are the same", () => {
            expect(NumberUtils.getPercentVariation(5, 5)).toBe(0);
        });
    });

    describe("decreaseNumberByPercent", () => {
        test("Should correctly decrease a number by negative percent", () => {
            expect(NumberUtils.decreaseNumberByPercent(10, -50)).toBe(5);
        });

        test("Should correctly decrease a number by positive percent", () => {
            expect(NumberUtils.decreaseNumberByPercent(10, 50)).toBe(5);
        });

        test("Should throw an error for an invalid argument", () => {
            try {
                NumberUtils.decreaseNumberByPercent(-10, -50)
                fail("Should throw an error");
            } catch (e) {
                // assert
                expect(e.message).toContain("-10 must be a positive number");
            }
        });
    });

    describe("increaseNumberByPercent", () => {
        test("Should correctly increase a number by percent", () => {
            expect(NumberUtils.increaseNumberByPercent(10, 50)).toBe(15);
        });

        test("Should correctly increase a number by percent", () => {
            expect(NumberUtils.increaseNumberByPercent(100, 0.1)).toBe(100.1);
        });

        test("Should throw an error for an invalid argument", () => {
            try {
                NumberUtils.increaseNumberByPercent(-10, -50)
                fail("Should throw an error");
            } catch (e) {
                // assert
                expect(e.message).toContain("-10 must be a positive number");
            }
        });
    });
});