// SPDX-License-Identifier: AGPL-3.0-only

/*
    SegmentTree.sol - SKALE Manager
    Copyright (C) 2021-Present SKALE Labs
    @author Artem Payvin
    @author Dmytro Stebaiev

    SKALE Manager is free software: you can redistribute it and/or modify
    it under the terms of the GNU Affero General Public License as published
    by the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    SKALE Manager is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU Affero General Public License for more details.

    You should have received a copy of the GNU Affero General Public License
    along with SKALE Manager.  If not, see <https://www.gnu.org/licenses/>.
*/

pragma solidity 0.8.26;

import { IRandom, Random } from "./Random.sol";

/**
 * @title SegmentTree
 * @dev This library implements segment tree data structure
 *
 * Segment tree allows effectively calculate sum of elements in sub arrays
 * by storing some amount of additional data.
 *
 * IMPORTANT: Provided implementation assumes that arrays is indexed from 1 to n.
 * Size of initial array always must be power of 2
 *
 * Example:
 *
 * Array:
 * +---+---+---+---+---+---+---+---+
 * | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
 * +---+---+---+---+---+---+---+---+
 *
 * Segment tree structure:
 * +-------------------------------+
 * |               36              |
 * +---------------+---------------+
 * |       10      |       26      |
 * +-------+-------+-------+-------+
 * |   3   |   7   |   11  |   15  |
 * +---+---+---+---+---+---+---+---+
 * | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
 * +---+---+---+---+---+---+---+---+
 *
 * How the segment tree is stored in an array:
 * +----+----+----+---+---+----+----+---+---+---+---+---+---+---+---+
 * | 36 | 10 | 26 | 3 | 7 | 11 | 15 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |
 * +----+----+----+---+---+----+----+---+---+---+---+---+---+---+---+
 */
library SegmentTree {
    using Random for IRandom.RandomGenerator;

    struct Tree {
        uint256[] tree;
    }

    /**
     * @dev Allocates storage for segment tree of `size` elements
     *
     * Requirements:
     *
     * - `size` must be greater than 0
     * - `size` must be power of 2
     */
    function create(Tree storage segmentTree, uint256 size) external {
        require(size > 0, "Size can't be 0");
        require(size & size - 1 == 0, "Size is not power of 2");
        segmentTree.tree = new uint256[](size * 2 - 1);
    }

    /**
     * @dev Adds `delta` to element of segment tree at `place`
     *
     * Requirements:
     *
     * - `place` must be in range [1, size]
     */
    function addToPlace(Tree storage self, uint256 place, uint256 delta) external {
        require(_correctPlace(self, place), "Incorrect place");
        uint256 leftBound = 1;
        uint256 rightBound = getSize(self);
        uint256 step = 1;
        self.tree[0] = self.tree[0] + delta;
        while(leftBound < rightBound) {
            uint256 middle = (leftBound + rightBound) / 2;
            if (place > middle) {
                leftBound = middle + 1;
                step = step + step + 1;
            } else {
                rightBound = middle;
                step = step + step;
            }
            self.tree[step - 1] = self.tree[step - 1] + delta;
        }
    }

    /**
     * @dev Subtracts `delta` from element of segment tree at `place`
     *
     * Requirements:
     *
     * - `place` must be in range [1, size]
     * - initial value of target element must be not less than `delta`
     */
    function removeFromPlace(Tree storage self, uint256 place, uint256 delta) external {
        require(_correctPlace(self, place), "Incorrect place");
        uint256 leftBound = 1;
        uint256 rightBound = getSize(self);
        uint256 step = 1;
        self.tree[0] = self.tree[0] - delta;
        while(leftBound < rightBound) {
            uint256 middle = (leftBound + rightBound) / 2;
            if (place > middle) {
                leftBound = middle + 1;
                step = step + step + 1;
            } else {
                rightBound = middle;
                step = step + step;
            }
            self.tree[step - 1] = self.tree[step - 1] - delta;
        }
    }

    /**
     * @dev Adds `delta` to element of segment tree at `toPlace`
     * and subtracts `delta` from element at `fromPlace`
     *
     * Requirements:
     *
     * - `fromPlace` must be in range [1, size]
     * - `toPlace` must be in range [1, size]
     * - initial value of element at `fromPlace` must be not less than `delta`
     */
    function moveFromPlaceToPlace(
        Tree storage self,
        uint256 fromPlace,
        uint256 toPlace,
        uint256 delta
    )
        external
    {
        require(_correctPlace(self, fromPlace) && _correctPlace(self, toPlace), "Incorrect place");
        uint256 leftBound = 1;
        uint256 rightBound = getSize(self);
        uint256 step = 1;
        uint256 middle = (leftBound + rightBound) / 2;
        uint256 fromPlaceMove = fromPlace > toPlace ? toPlace : fromPlace;
        uint256 toPlaceMove = fromPlace > toPlace ? fromPlace : toPlace;
        while (toPlaceMove <= middle || middle < fromPlaceMove) {
            if (middle < fromPlaceMove) {
                leftBound = middle + 1;
                step = step + step + 1;
            } else {
                rightBound = middle;
                step = step + step;
            }
            middle = (leftBound + rightBound) / 2;
        }

        uint256 leftBoundMove = leftBound;
        uint256 rightBoundMove = rightBound;
        uint256 stepMove = step;
        while(leftBoundMove < rightBoundMove && leftBound < rightBound) {
            uint256 middleMove = (leftBoundMove + rightBoundMove) / 2;
            if (fromPlace > middleMove) {
                leftBoundMove = middleMove + 1;
                stepMove = stepMove + stepMove + 1;
            } else {
                rightBoundMove = middleMove;
                stepMove = stepMove + stepMove;
            }
            self.tree[stepMove - 1] = self.tree[stepMove - 1] - delta;
            middle = (leftBound + rightBound) / 2;
            if (toPlace > middle) {
                leftBound = middle + 1;
                step = step + step + 1;
            } else {
                rightBound = middle;
                step = step + step;
            }
            self.tree[step - 1] = self.tree[step - 1] + delta;
        }
    }

    /**
     * @dev Returns random position in range [`place`, size]
     * with probability proportional to value stored at this position.
     * If all element in range are 0 returns 0
     *
     * Requirements:
     *
     * - `place` must be in range [1, size]
     */
    function getRandomNonZeroElementFromPlaceToLast(
        Tree storage self,
        uint256 place,
        IRandom.RandomGenerator memory randomGenerator
    )
        external
        view
        returns (uint256 position)
    {
        require(_correctPlace(self, place), "Incorrect place");

        uint256 vertex = 1;
        uint256 leftBound = 0;
        uint256 rightBound = getSize(self);
        uint256 currentFrom = place - 1;
        uint256 currentSum = sumFromPlaceToLast(self, place);
        if (currentSum == 0) {
            return 0;
        }
        while(leftBound + 1 < rightBound) {
            if (_middle(leftBound, rightBound) <= currentFrom) {
                vertex = _right(vertex);
                leftBound = _middle(leftBound, rightBound);
            } else {
                uint256 rightSum = self.tree[_right(vertex) - 1];
                uint256 leftSum = currentSum - rightSum;
                if (Random.random(randomGenerator, currentSum) < leftSum) {
                    // go left
                    vertex = _left(vertex);
                    rightBound = _middle(leftBound, rightBound);
                    currentSum = leftSum;
                } else {
                    // go right
                    vertex = _right(vertex);
                    leftBound = _middle(leftBound, rightBound);
                    currentFrom = leftBound;
                    currentSum = rightSum;
                }
            }
        }
        return leftBound + 1;
    }

    /**
     * @dev Returns sum of elements in range [`place`, size]
     *
     * Requirements:
     *
     * - `place` must be in range [1, size]
     */
    function sumFromPlaceToLast(
        Tree storage self,
        uint256 place
    )
        public
        view
        returns (uint256 sum)
    {
        require(_correctPlace(self, place), "Incorrect place");
        if (place == 1) {
            return self.tree[0];
        }
        uint256 leftBound = 1;
        uint256 rightBound = getSize(self);
        uint256 step = 1;
        while(leftBound < rightBound) {
            uint256 middle = (leftBound + rightBound) / 2;
            if (place > middle) {
                leftBound = middle + 1;
                step = step + step + 1;
            } else {
                rightBound = middle;
                step = step + step;
                sum = sum + self.tree[step];
            }
        }
        sum = sum + self.tree[step - 1];
    }

    /**
     * @dev Returns amount of elements in segment tree
     */
    function getSize(Tree storage segmentTree) internal view returns (uint256 size) {
        if (segmentTree.tree.length > 0) {
            return segmentTree.tree.length / 2 + 1;
        } else {
            return 0;
        }
    }

    /**
     * @dev Checks if `place` is valid position in segment tree
     */
    function _correctPlace(Tree storage self, uint256 place) private view returns (bool correct) {
        return place >= 1 && place <= getSize(self);
    }

    /**
     * @dev Calculates index of left child of the vertex
     */
    function _left(uint256 vertex) private pure returns (uint256 index) {
        return vertex * 2;
    }

    /**
     * @dev Calculates index of right child of the vertex
     */
    function _right(uint256 vertex) private pure returns (uint256 index) {
        return vertex * 2 + 1;
    }

    /**
     * @dev Calculates arithmetical mean of 2 numbers
     */
    function _middle(uint256 left, uint256 right) private pure returns (uint256 mean) {
        return (left + right) / 2;
    }
}
