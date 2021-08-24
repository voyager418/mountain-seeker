import { GlobalUtils } from "../../src/utils/global-utils";

describe("Global utils", () => {
    describe("decreaseNumberByPercent", () => {
        test("Should correctly decrease a number by negative percent", () => {
            expect(GlobalUtils.decreaseNumberByPercent(10, -50)).toBe(5);
        });

        test("Should correctly decrease a number by positive percent", () => {
            expect(GlobalUtils.decreaseNumberByPercent(10, 50)).toBe(5);
        });

        test("Should throw an error for an invalid argument", () => {
            try {
                GlobalUtils.decreaseNumberByPercent(-10, -50)
                fail("Should throw an error");
            } catch (e) {
                // assert
                expect(e.message).toContain("-10 must be a positive number");
            }
        });
    });

    describe("increaseNumberByPercent", () => {
        test("Should correctly increase a number by percent", () => {
            expect(GlobalUtils.increaseNumberByPercent(10, 50)).toBe(15);
        });

        test("Should throw an error for an invalid argument", () => {
            try {
                GlobalUtils.increaseNumberByPercent(-10, -50)
                fail("Should throw an error");
            } catch (e) {
                // assert
                expect(e.message).toContain("-10 must be a positive number");
            }
        });
    });
});