/*
    SchainsFunctionalityInternal.sol - SKALE Manager
    Copyright (C) 2018-Present SKALE Labs
    @author Artem Payvin

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

pragma solidity ^0.5.0;

import "./GroupsFunctionality.sol";
import "./interfaces/INodesData.sol";
import "./interfaces/ISchainsData.sol";
import "./interfaces/IConstants.sol";


/**
 * @title SchainsFunctionality - contract contains all functionality logic to manage Schains
 */
contract SchainsFunctionalityInternal is GroupsFunctionality {
    // informs that Schain based on some Nodes
    event SchainNodes(
        string name,
        bytes32 groupIndex,
        uint[] nodesInGroup,
        uint32 time,
        uint gasSpend
    );



    constructor(string memory newExecutorName,
                string memory newDataName,
                address newContractsAddress)
                GroupsFunctionality(newExecutorName, newDataName, newContractsAddress) public {

    }

    /**
     * @dev createGroupForSchain - creates Group for Schain
     * @param schainName - name of Schain
     * @param schainId - hash by name of Schain
     * @param numberOfNodes - number of Nodes needed for this Schain
     * @param partOfNode - divisor of given type of Schain
     */
    function createGroupForSchain(
        string calldata schainName,
        bytes32 schainId,
        uint numberOfNodes,
        uint partOfNode) external allow(executorName)
    {
        address dataAddress = contractManager.contracts(keccak256(abi.encodePacked(dataName)));
        addGroup(schainId, numberOfNodes, bytes32(partOfNode));
        uint[] memory numberOfNodesInGroup = generateGroup(schainId);
        ISchainsData(dataAddress).setSchainPartOfNode(schainId, partOfNode);
        emit SchainNodes(
            schainName,
            schainId,
            numberOfNodesInGroup,
            uint32(block.timestamp),
            gasleft());
    }

    /**
     * @dev getNodesDataFromTypeOfSchain - returns number if Nodes
     * and part of Node which needed to this Schain
     * @param typeOfSchain - type of Schain
     * @return numberOfNodes - number of Nodes needed to this Schain
     * @return partOfNode - divisor of given type of Schain
     */
    function getNodesDataFromTypeOfSchain(uint typeOfSchain) external view returns (uint numberOfNodes, uint partOfNode) {
        address constantsAddress = contractManager.contracts(keccak256(abi.encodePacked("Constants")));
        numberOfNodes = IConstants(constantsAddress).NUMBER_OF_NODES_FOR_SCHAIN();
        if (typeOfSchain == 1) {
            partOfNode = IConstants(constantsAddress).TINY_DIVISOR();
        } else if (typeOfSchain == 2) {
            partOfNode = IConstants(constantsAddress).SMALL_DIVISOR();
        } else if (typeOfSchain == 3) {
            partOfNode = IConstants(constantsAddress).MEDIUM_DIVISOR();
        } else if (typeOfSchain == 4) {
            partOfNode = 0;
            numberOfNodes = IConstants(constantsAddress).NUMBER_OF_NODES_FOR_TEST_SCHAIN();
        } else if (typeOfSchain == 5) {
            partOfNode = IConstants(constantsAddress).MEDIUM_TEST_DIVISOR();
            numberOfNodes = IConstants(constantsAddress).NUMBER_OF_NODES_FOR_MEDIUM_TEST_SCHAIN();
        } else {
            revert("Bad schain type");
        }
    }

    function replaceNode(
        uint nodeIndex,
        bytes32 groupHash
    )
        external
        allow(executorName) returns (bytes32 schainId, uint newNodeIndex)
    {
        removeNodeFromSchain(nodeIndex, groupHash);
        (schainId, newNodeIndex) = selectNodeToGroup(groupHash);
    }

    /**
     * @dev findSchainAtSchainsForNode - finds index of Schain at schainsForNode array
     * @param nodeIndex - index of Node at common array of Nodes
     * @param schainId - hash of name of Schain
     * @return index of Schain at schainsForNode array
     */
    function findSchainAtSchainsForNode(uint nodeIndex, bytes32 schainId) public view returns (uint) {
        address dataAddress = contractManager.contracts(keccak256(abi.encodePacked(dataName)));
        uint length = ISchainsData(dataAddress).getLengthOfSchainsForNode(nodeIndex);
        for (uint i = 0; i < length; i++) {
            if (ISchainsData(dataAddress).schainsForNodes(nodeIndex, i) == schainId) {
                return i;
            }
        }
        return length;
    }

    function removeNodeFromSchain(uint nodeIndex, bytes32 groupHash) public {
        address schainsDataAddress = contractManager.contracts(keccak256(abi.encodePacked("SchainsData")));
        uint groupIndex = findSchainAtSchainsForNode(nodeIndex, groupHash);
        uint indexOfNode = findNode(groupHash, nodeIndex);
        IGroupsData(schainsDataAddress).removeNodeFromGroup(indexOfNode, groupHash);
        IGroupsData(schainsDataAddress).removeExceptionNode(groupHash, nodeIndex);
        ISchainsData(schainsDataAddress).removeSchainForNode(nodeIndex, groupIndex);
    }

    /**
     * @dev selectNodeToGroup - pseudo-randomly select new Node for Schain
     * @param groupIndex - hash of name of Schain
     * @return groupIndex - hash of name of Schain which needed for emitting event
     * @return nodeIndex - global index of Node
     */
    function selectNodeToGroup(bytes32 groupIndex) internal returns (bytes32, uint) {
        IGroupsData groupsData = IGroupsData(contractManager.contracts(keccak256(abi.encodePacked(dataName))));
        ISchainsData schainsData = ISchainsData(contractManager.contracts(keccak256(abi.encodePacked(dataName))));
        INodesData nodesData = INodesData(contractManager.contracts(keccak256(abi.encodePacked("NodesData"))));
        require(groupsData.isGroupActive(groupIndex), "Group is not active");
        uint space;
        (, space) = setNumberOfNodesInGroup(groupIndex, uint(groupsData.getGroupData(groupIndex)), address(groupsData));
        uint[] memory possibleNodes = nodesData.getNodesWithFreeSpace(uint(groupsData.getGroupData(groupIndex)), space);
        require(possibleNodes.length > 0, "No any free Nodes for rotation");
        uint nodeIndex;
        uint random = uint(keccak256(abi.encodePacked(uint(blockhash(block.number - 1)), groupIndex)));
        do {
            uint index = random % possibleNodes.length;
            nodeIndex = possibleNodes[index];
            random = uint(keccak256(abi.encodePacked(random, nodeIndex)));
        } while (groupsData.isExceptionNode(groupIndex, nodeIndex));
        require(removeSpace(nodeIndex, space), "Could not remove space from nodeIndex");
        schainsData.addSchainForNode(nodeIndex, groupIndex);
        groupsData.setException(groupIndex, nodeIndex);
        groupsData.setNodeInGroup(groupIndex, nodeIndex);
        return (groupIndex, nodeIndex);
    }

    /**
     * @dev generateGroup - generates Group for Schain
     * @param groupIndex - index of Group
     */
    function generateGroup(bytes32 groupIndex) internal returns (uint[] memory nodesInGroup) {
        IGroupsData groupsData = IGroupsData(contractManager.contracts(keccak256(abi.encodePacked(dataName))));
        ISchainsData schainsData = ISchainsData(contractManager.contracts(keccak256(abi.encodePacked(dataName))));
        INodesData nodesData = INodesData(contractManager.contracts(keccak256(abi.encodePacked("NodesData"))));
        require(groupsData.isGroupActive(groupIndex), "Group is not active");

        uint numberOfNodes;
        uint space;
        (numberOfNodes, space) = setNumberOfNodesInGroup(groupIndex, uint(groupsData.getGroupData(groupIndex)), address(groupsData));

        nodesInGroup = new uint[](groupsData.getRecommendedNumberOfNodes(groupIndex));

        uint[] memory possibleNodes = nodesData.getNodesWithFreeSpace(uint(groupsData.getGroupData(groupIndex)), space);

        require(possibleNodes.length >= nodesInGroup.length, "Not enough nodes to create Schain");
        uint ignoringTail = 0;
        uint random = uint(keccak256(abi.encodePacked(uint(blockhash(block.number - 1)), groupIndex)));
        for (uint i = 0; i < nodesInGroup.length; ++i) {
            uint index = random % (possibleNodes.length - ignoringTail);
            uint node = possibleNodes[index];
            nodesInGroup[i] = node;
            swap(possibleNodes, index, possibleNodes.length - ignoringTail - 1);
            ++ignoringTail;

            groupsData.setException(groupIndex, node);
            schainsData.addSchainForNode(node, groupIndex);
            require(removeSpace(node, space), "Could not remove space from Node");
        }

        // set generated group
        groupsData.setNodesInGroup(groupIndex, nodesInGroup);
        emit GroupGenerated(
            groupIndex,
            nodesInGroup,
            uint32(block.timestamp),
            gasleft());
    }

    /**
     * @dev removeSpace - occupy space of given Node
     * @param nodeIndex - index of Node at common array of Nodes
     * @param space - needed space to occupy
     * @return if ouccupied - true, else - false
     */
    function removeSpace(uint nodeIndex, uint space) internal returns (bool) {
        address nodesDataAddress = contractManager.contracts(keccak256(abi.encodePacked("NodesData")));
        uint subarrayLink;
        bool isNodeFull;
        (subarrayLink, isNodeFull) = INodesData(nodesDataAddress).nodesLink(nodeIndex);
        if (isNodeFull) {
            return INodesData(nodesDataAddress).removeSpaceFromFullNode(subarrayLink, space);
        } else {
            return INodesData(nodesDataAddress).removeSpaceFromFractionalNode(subarrayLink, space);
        }
    }

    /**
     * @dev setNumberOfNodesInGroup - checks is Nodes enough to create Schain
     * and returns number of Nodes in group
     * and how much space would be occupied on its, based on given type of Schain
     * @param groupIndex - Groups identifier
     * @param partOfNode - divisor of given type of Schain
     * @param dataAddress - address of Data contract
     * @return numberOfNodes - number of Nodes in Group
     * @return space - needed space to occupy
     */
    function setNumberOfNodesInGroup(bytes32 groupIndex, uint partOfNode, address dataAddress)
    internal view returns (uint numberOfNodes, uint space)
    {
        address nodesDataAddress = contractManager.contracts(keccak256(abi.encodePacked("NodesData")));
        address constantsAddress = contractManager.contracts(keccak256(abi.encodePacked("Constants")));
        address schainsDataAddress = contractManager.contracts(keccak256(abi.encodePacked("SchainsData")));
        uint numberOfAvailableNodes = 0;
        uint needNodes = 1;
        bool nodesEnough = false;
        if (IGroupsData(schainsDataAddress).getNumberOfNodesInGroup(groupIndex) == 0) {
            needNodes = IGroupsData(dataAddress).getRecommendedNumberOfNodes(groupIndex);
        }
        if (partOfNode == IConstants(constantsAddress).MEDIUM_DIVISOR()) {
            space = IConstants(constantsAddress).TINY_DIVISOR() / partOfNode;
            numberOfNodes = INodesData(nodesDataAddress).getNumberOfFullNodes();
            nodesEnough = INodesData(nodesDataAddress).getNumberOfFreeFullNodes(needNodes);
        } else if (partOfNode == IConstants(constantsAddress).TINY_DIVISOR() || partOfNode == IConstants(constantsAddress).SMALL_DIVISOR()) {
            space = IConstants(constantsAddress).TINY_DIVISOR() / partOfNode;
            numberOfNodes = INodesData(nodesDataAddress).getNumberOfFractionalNodes();
            nodesEnough = INodesData(nodesDataAddress).getNumberOfFreeFractionalNodes(space, needNodes);
        } else if (partOfNode == IConstants(constantsAddress).MEDIUM_TEST_DIVISOR()) {
            space = IConstants(constantsAddress).TINY_DIVISOR() / partOfNode;
            numberOfNodes = INodesData(nodesDataAddress).getNumberOfNodes();
            numberOfAvailableNodes = INodesData(nodesDataAddress).numberOfActiveNodes();
            nodesEnough = numberOfAvailableNodes >= needNodes ? true : false;
        } else if (partOfNode == 0) {
            space = partOfNode;
            numberOfNodes = INodesData(nodesDataAddress).getNumberOfNodes();
            numberOfAvailableNodes = INodesData(nodesDataAddress).numberOfActiveNodes();
            nodesEnough = numberOfAvailableNodes >= needNodes ? true : false;
        } else {
            revert("Can't set number of nodes. Divisor does not match any valid schain type");
        }
        //Check that schain is not created yet
        require(nodesEnough, "Not enough nodes to create Schain");
    }
}