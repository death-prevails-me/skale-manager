import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {deployContractManager} from "../tools/deploy/contractManager";
import {deploySegmentTreeTester} from "../tools/deploy/test/segmentTreeTester";
import {makeSnapshot, applySnapshot} from "../tools/snapshot";
import {SegmentTreeTester} from "../../typechain-types";

chai.should();
chai.use(chaiAsPromised);

describe("SegmentTree", () => {
    let segmentTree: SegmentTreeTester;
    let snapshot: number;
    let cleanContracts: number;
    before(async () => {
        const contractManager = await deployContractManager();
        segmentTree = await deploySegmentTreeTester(contractManager);
    });

    beforeEach(async () => {
        snapshot = await makeSnapshot();
    });

    afterEach(async () => {
        await applySnapshot(snapshot);
    });

    describe("initialization", () => {
        it("Should check last right leaf of segment tree", async () => {
            await segmentTree.addElemInPlaces(128, 150);
            await segmentTree.initTree();
            (await segmentTree.getElem(254)).should.be.equal(150);
        });

        it("Should check all parents of last right leaf of segment tree", async () => {
            await segmentTree.addElemInPlaces(128, 150);
            await segmentTree.initTree();
            for(let i = 1; i <= 8; i++) {
                (await segmentTree.getElem(2 ** i - 2)).should.be.equal(150);
            }
        });

        it("Should check other elements", async () => {
            await segmentTree.addElemInPlaces(128, 150);
            await segmentTree.initTree();
            for(let j = 1; j <= 253; j++) {
                let isRightLeaf = false;
                for(let i = 1; i <= 8; i++) {
                    if (j === 2 ** i - 2) {
                        isRightLeaf = true;
                    }
                }
                (await segmentTree.getElem(j)).should.be.equal(isRightLeaf ? 150 : 0);
            }
        });

        it("should check elements after adding to last", async () => {
            await segmentTree.addElemInPlaces(128, 150);
            await segmentTree.initTree();
            await segmentTree.addToLast(10);
            for(let j = 1; j <= 253; j++) {
                let isRightLeaf = false;
                for(let i = 1; i <= 8; i++) {
                    if (j === 2 ** i - 2) {
                        isRightLeaf = true;
                    }
                }
                (await segmentTree.getElem(j)).should.be.equal(isRightLeaf ? 160 : 0);
            }
        });

        it("should reject if index is incorrect", async () => {
            await segmentTree.addElemInPlaces(128, 150);
            await segmentTree.initTree();
            await segmentTree.getElem(254);
            await segmentTree.getElem(255).should.be.eventually.rejectedWith("Incorrect index");
            await segmentTree.getElem(100000000000).should.be.eventually.rejectedWith("Incorrect index");
        });

        it("should initialize if elements not only at last place", async () => {
            await segmentTree.addElemInPlaces(128, 150);
            await segmentTree.addElemInPlaces(64, 50);
            await segmentTree.addElemInPlaces(7, 34);
            await segmentTree.initTree();
            (await segmentTree.getElem(254)).should.be.equal(150);
            (await segmentTree.getElem(190)).should.be.equal(50);
            (await segmentTree.getElem(133)).should.be.equal(34);
            (await segmentTree.getElem(0)).should.be.equal(234);
            (await segmentTree.getElem(1)).should.be.equal(84);
            (await segmentTree.getElem(2)).should.be.equal(150);
            (await segmentTree.getElem(3)).should.be.equal(34);
            (await segmentTree.getElem(4)).should.be.equal(50);
            (await segmentTree.getElem(5)).should.be.equal(0);
            (await segmentTree.getElem(6)).should.be.equal(150);
        });
    });

    describe("when initialized", () => {
        before(async () => {
            cleanContracts = await makeSnapshot();
            await segmentTree.addElemInPlaces(128, 150);
            await segmentTree.initTree();
        });

        after(async () => {
            await applySnapshot(cleanContracts);
        });

        describe("move elements", () => {
            it("should add elem to some place", async () => {
                await segmentTree.addToPlace(53, 12);
                (await segmentTree.getElem(0)).should.be.equal(162);
                let lastLeaf = 180;
                while (lastLeaf > 1) {
                    (await segmentTree.getElem(lastLeaf - 1)).should.be.equal(12);
                    lastLeaf = Math.floor(lastLeaf / 2);
                }
            });

            it("should add elem and remove elem to some place", async () => {
                await segmentTree.addToPlace(53, 12);
                (await segmentTree.getElem(0)).should.be.equal(162);
                let lastLeaf = 180;
                while (lastLeaf > 1) {
                    (await segmentTree.getElem(lastLeaf - 1)).should.be.equal(12);
                    lastLeaf = Math.floor(lastLeaf / 2);
                }
                await segmentTree.removeFromPlace(53, 5);
                (await segmentTree.getElem(0)).should.be.equal(157);
                lastLeaf = 180;
                while (lastLeaf > 1) {
                    (await segmentTree.getElem(lastLeaf - 1)).should.be.equal(7);
                    lastLeaf = Math.floor(lastLeaf / 2);
                }
            });

            it("should remove from one and move to another place", async () => {
                await segmentTree.removeFromPlace(128, 16);
                (await segmentTree.getElem(0)).should.be.equal(134);
                let lastLeaf = 255;
                while (lastLeaf > 1) {
                    (await segmentTree.getElem(lastLeaf - 1)).should.be.equal(134);
                    lastLeaf = Math.floor(lastLeaf / 2);
                }
                await segmentTree.addToPlace(23, 16);
                (await segmentTree.getElem(0)).should.be.equal(150);
                lastLeaf = 150;
                while (lastLeaf > 1) {
                    (await segmentTree.getElem(lastLeaf - 1)).should.be.equal(16);
                    lastLeaf = Math.floor(lastLeaf / 2);
                }
            });

            it("should remove from one and move to another place optimized", async () => {
                await segmentTree.moveFromPlaceToPlace(128, 127, 16);
                (await segmentTree.getElem(0)).should.be.equal(150);
                let lastLeaf = 254;
                (await segmentTree.getElem(lastLeaf)).should.be.equal(134);
                (await segmentTree.getElem(lastLeaf - 1)).should.be.equal(16);
                lastLeaf = Math.floor(lastLeaf / 2);
                while (lastLeaf > 1) {
                    (await segmentTree.getElem(lastLeaf - 1)).should.be.equal(150);
                    lastLeaf = Math.floor(lastLeaf / 2);
                }
                await segmentTree.moveFromPlaceToPlace(127, 128, 16);
                (await segmentTree.getElem(0)).should.be.equal(150);
                lastLeaf = 255;
                while (lastLeaf > 1) {
                    (await segmentTree.getElem(lastLeaf - 1)).should.be.equal(150);
                    lastLeaf = Math.floor(lastLeaf / 2);
                }
            });

            it("should move from one to another place", async () => {
                await segmentTree.moveFromPlaceToPlace(128, 96, 16);
                (await segmentTree.getElem(0)).should.be.equal(150);
                await segmentTree.moveFromPlaceToPlace(96, 64, 16);
                (await segmentTree.getElem(0)).should.be.equal(150);
                await segmentTree.moveFromPlaceToPlace(64, 32, 16);
                (await segmentTree.getElem(0)).should.be.equal(150);
                await segmentTree.moveFromPlaceToPlace(32, 1, 16);
                let lastLeaf = 255;
                while (lastLeaf > 1) {
                    (await segmentTree.getElem(lastLeaf - 1)).should.be.equal(134);
                    lastLeaf = Math.floor(lastLeaf / 2);
                }
                lastLeaf = 128;
                while (lastLeaf > 1) {
                    (await segmentTree.getElem(lastLeaf - 1)).should.be.equal(16);
                    lastLeaf = Math.floor(lastLeaf / 2);
                }
            });

            it("should reject if place is incorrect", async () => {
                await segmentTree.addToPlace(38, 16);
                await segmentTree.addToPlace(99, 16);
                await segmentTree.removeFromPlace(99, 16);
                await segmentTree.addToPlace(0, 16).should.be.eventually.rejectedWith("Incorrect place");
                await segmentTree.removeFromPlace(129, 16).should.be.eventually.rejectedWith("Incorrect place");
            });
        });

        describe("calculating sum", () => {
            it("should calculate correct sum", async () => {
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(150);
                (await segmentTree.sumFromPlaceToLast(1)).should.be.equal(150);
                (await segmentTree.sumFromPlaceToLast(128)).should.be.equal(150);
                (await segmentTree.sumFromPlaceToLast(127)).should.be.equal(150);
                (await segmentTree.sumFromPlaceToLast(126)).should.be.equal(150);
            });

            it("should calculate correct sum after adding some elements", async () => {
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(150);
                await segmentTree.addToPlace(101, 5);
                await segmentTree.addToPlace(31, 50);
                await segmentTree.addToLast(8);
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(163);
                (await segmentTree.sumFromPlaceToLast(101)).should.be.equal(163);
                (await segmentTree.sumFromPlaceToLast(102)).should.be.equal(158);
                (await segmentTree.sumFromPlaceToLast(80)).should.be.equal(163);
                (await segmentTree.sumFromPlaceToLast(32)).should.be.equal(163);
                (await segmentTree.sumFromPlaceToLast(31)).should.be.equal(213);
                (await segmentTree.sumFromPlaceToLast(128)).should.be.equal(158);
                (await segmentTree.sumFromPlaceToLast(127)).should.be.equal(158);
                (await segmentTree.sumFromPlaceToLast(126)).should.be.equal(158);
            });

            it("should calculate correct sum after adding and removing some elements", async () => {
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(150);
                await segmentTree.addToPlace(101, 5);
                await segmentTree.addToPlace(31, 50);
                await segmentTree.addToLast(8);
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(163);
                (await segmentTree.sumFromPlaceToLast(101)).should.be.equal(163);
                (await segmentTree.sumFromPlaceToLast(102)).should.be.equal(158);
                (await segmentTree.sumFromPlaceToLast(80)).should.be.equal(163);
                (await segmentTree.sumFromPlaceToLast(32)).should.be.equal(163);
                (await segmentTree.sumFromPlaceToLast(31)).should.be.equal(213);
                (await segmentTree.sumFromPlaceToLast(128)).should.be.equal(158);
                (await segmentTree.sumFromPlaceToLast(127)).should.be.equal(158);
                (await segmentTree.sumFromPlaceToLast(126)).should.be.equal(158);
                await segmentTree.removeFromPlace(128, 30);
                await segmentTree.removeFromPlace(101, 5);
                await segmentTree.removeFromPlace(31, 2);
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(128);
                (await segmentTree.sumFromPlaceToLast(101)).should.be.equal(128);
                (await segmentTree.sumFromPlaceToLast(102)).should.be.equal(128);
                (await segmentTree.sumFromPlaceToLast(80)).should.be.equal(128);
                (await segmentTree.sumFromPlaceToLast(32)).should.be.equal(128);
                (await segmentTree.sumFromPlaceToLast(31)).should.be.equal(176);
                (await segmentTree.sumFromPlaceToLast(128)).should.be.equal(128);
                (await segmentTree.sumFromPlaceToLast(127)).should.be.equal(128);
                (await segmentTree.sumFromPlaceToLast(126)).should.be.equal(128);
            });

            it("should calculate correct sum after moving some elements", async () => {
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(150);
                await segmentTree.moveFromPlaceToPlace(128, 101, 5);
                await segmentTree.moveFromPlaceToPlace(128, 31, 50);
                await segmentTree.addToLast(8);
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(108);
                (await segmentTree.sumFromPlaceToLast(101)).should.be.equal(108);
                (await segmentTree.sumFromPlaceToLast(102)).should.be.equal(103);
                (await segmentTree.sumFromPlaceToLast(80)).should.be.equal(108);
                (await segmentTree.sumFromPlaceToLast(32)).should.be.equal(108);
                (await segmentTree.sumFromPlaceToLast(31)).should.be.equal(158);
                (await segmentTree.sumFromPlaceToLast(128)).should.be.equal(103);
                (await segmentTree.sumFromPlaceToLast(127)).should.be.equal(103);
                (await segmentTree.sumFromPlaceToLast(126)).should.be.equal(103);
                await segmentTree.moveFromPlaceToPlace(128, 80, 30);
                await segmentTree.removeFromPlace(101, 5);
                await segmentTree.moveFromPlaceToPlace(128, 31, 2);
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(71);
                (await segmentTree.sumFromPlaceToLast(101)).should.be.equal(71);
                (await segmentTree.sumFromPlaceToLast(102)).should.be.equal(71);
                (await segmentTree.sumFromPlaceToLast(81)).should.be.equal(71);
                (await segmentTree.sumFromPlaceToLast(80)).should.be.equal(101);
                (await segmentTree.sumFromPlaceToLast(32)).should.be.equal(101);
                (await segmentTree.sumFromPlaceToLast(31)).should.be.equal(153);
                (await segmentTree.sumFromPlaceToLast(128)).should.be.equal(71);
                (await segmentTree.sumFromPlaceToLast(127)).should.be.equal(71);
                (await segmentTree.sumFromPlaceToLast(126)).should.be.equal(71);
            });
        });

        describe("random elem", () => {
            it("should return last place", async () => {
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(150);
                (await segmentTree.getRandomElem(100)).should.be.equal(128);
            });

            it("should return zero if no place", async () => {
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(150);
                (await segmentTree.getRandomElem(100)).should.be.equal(128);
                await segmentTree.removeFromPlace(128, 150);
                (await segmentTree.sumFromPlaceToLast(1)).should.be.equal(0);
                (await segmentTree.getRandomElem(1)).should.be.equal(0);
                await segmentTree.addToPlace(99, 150);
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(0);
                (await segmentTree.getRandomElem(100)).should.be.equal(0);
                (await segmentTree.sumFromPlaceToLast(99)).should.be.equal(150);
                (await segmentTree.getRandomElem(99)).should.be.equal(99);
            });

            it("should reject if place is incorrect", async () => {
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(150);
                (await segmentTree.getRandomElem(100)).should.be.equal(128);
                await segmentTree.removeFromPlace(128, 150);
                (await segmentTree.sumFromPlaceToLast(1)).should.be.equal(0);
                (await segmentTree.getRandomElem(1)).should.be.equal(0);
                await segmentTree.addToPlace(99, 150);
                (await segmentTree.sumFromPlaceToLast(100)).should.be.equal(0);
                (await segmentTree.getRandomElem(100)).should.be.equal(0);
                (await segmentTree.sumFromPlaceToLast(99)).should.be.equal(150);
                (await segmentTree.getRandomElem(99)).should.be.equal(99);
                await segmentTree.getRandomElem(0).should.be.rejectedWith("Incorrect place");
                (await segmentTree.getRandomElem(128)).should.be.equal(0);
                await segmentTree.addToPlace(128, 1000);
                (await segmentTree.getRandomElem(128)).should.be.equal(128);
                (await segmentTree.getRandomElem(127)).should.be.equal(128);
                await segmentTree.removeFromPlace(128, 1000);
                (await segmentTree.getRandomElem(128)).should.be.equal(0);
                (await segmentTree.getRandomElem(127)).should.be.equal(0);
                await segmentTree.addToPlace(127, 1000);
                (await segmentTree.getRandomElem(128)).should.be.equal(0);
                (await segmentTree.getRandomElem(127)).should.be.equal(127);
                await segmentTree.getRandomElem(129).should.be.rejectedWith("Incorrect place");
                await segmentTree.getRandomElem(100000).should.be.rejectedWith("Incorrect place");
            });

            it("should return and remove random places", async () => {
                await segmentTree.addToPlace(127, 5);
                await segmentTree.addToPlace(54, 50);
                await segmentTree.addToPlace(106, 25);
                await segmentTree.addToPlace(77, 509);
                for(let i = 0; i < 180; i++) {
                    const place = (await segmentTree.getRandomElem(78));
                    await segmentTree.removeFromPlace(place, 1);
                }
                (await segmentTree.getRandomElem(78)).should.be.equal(0);
                (await segmentTree.getRandomElem(77)).should.be.equal(77);
            });

            it("random stress simulating large schains test", async () => {
                const schainPlace = 32n; // 1/4 of node
                await segmentTree.removeFromPlace(128, 100); // make 50 nodes
                for(let i = 0; i < 200; i++) { // 200 times we could repeat removing
                    const place = (await segmentTree.getRandomElem(schainPlace));
                    await segmentTree.removeFromPlace(place, 1);
                    if (place - schainPlace > 0) {
                        await segmentTree.addToPlace(place - schainPlace, 1);
                    }
                }
                // 201 time should be no nodes
                (await segmentTree.getRandomElem(schainPlace)).should.be.equal(0);
            });

            it("random stress simulating large schains test moving elements", async () => {
                const schainPlace = 32n; // 1/4 of node
                await segmentTree.removeFromPlace(128, 100); // make 50 nodes
                for(let i = 0; i < 200; i++) { // 200 times we could repeat removing
                    const place = (await segmentTree.getRandomElem(schainPlace));
                    if (place - schainPlace > 0) {
                        await segmentTree.moveFromPlaceToPlace(place, place - schainPlace, 1);
                    } else {
                        await segmentTree.removeFromPlace(place, 1);
                    }
                }
                // 201 time should be no nodes
                (await segmentTree.getRandomElem(schainPlace)).should.be.equal(0);
            });
        });
    });
});
