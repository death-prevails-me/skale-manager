import chaiAsPromised from "chai-as-promised";
import {ContractManager,
         Nodes,
         ValidatorService} from "../typechain-types";
import {skipTime} from "./tools/time";
import {privateKeys} from "./tools/private-keys";
import chai = require("chai");
import {deployContractManager} from "./tools/deploy/contractManager";
import {deployNodes} from "./tools/deploy/nodes";
import {deployValidatorService} from "./tools/deploy/delegation/validatorService";
import {deploySkaleManagerMock} from "./tools/deploy/test/skaleManagerMock";
import {Wallet} from "ethers";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {assert} from "chai";
import {getPublicKey, getValidatorIdSignature} from "./tools/signatures";
import {stringKeccak256} from "./tools/hashes";
import {fastBeforeEach} from "./tools/mocha";

chai.should();
chai.use(chaiAsPromised);

describe("NodesData", () => {
    let owner: SignerWithAddress;
    let validator: SignerWithAddress;
    let nodeAddress: Wallet;
    let admin: SignerWithAddress;
    let hacker: SignerWithAddress;

    let contractManager: ContractManager;
    let nodes: Nodes;
    let validatorService: ValidatorService;

    fastBeforeEach(async () => {
        [owner, validator, admin, hacker] = await ethers.getSigners();

        nodeAddress = new Wallet(String(privateKeys[2])).connect(ethers.provider);

        await owner.sendTransaction({to: nodeAddress.address, value: ethers.parseEther("10000")});

        contractManager = await deployContractManager();
        nodes = await deployNodes(contractManager);
        validatorService = await deployValidatorService(contractManager);
        const skaleManagerMock = await deploySkaleManagerMock(contractManager);

        await validatorService.connect(validator).registerValidator("Validator", "D2", 0, 0);
        const validatorIndex = await validatorService.getValidatorId(validator.address);
        const signature1 = await getValidatorIdSignature(validatorIndex, nodeAddress);
        await validatorService.connect(validator).linkNodeAddress(nodeAddress.address, signature1);
        await skaleManagerMock.grantRole(await skaleManagerMock.ADMIN_ROLE(), admin.address);

        const NODE_MANAGER_ROLE = await nodes.NODE_MANAGER_ROLE();
        await nodes.grantRole(NODE_MANAGER_ROLE, owner.address);
    });

    it("should add node", async () => {
        await nodes.createNode(
            nodeAddress.address,
            {
                port: 8545,
                nonce: 0,
                ip: "0x7f000001",
                publicIp: "0x7f000002",
                publicKey: getPublicKey(nodeAddress),
                name: "d2",
                domainName: "some.domain.name"
            });

        const node = await nodes.nodes(0);

        node[0].should.be.equal("d2");
        node[1].should.be.equal("0x7f000001");
        node[2].should.be.equal("0x7f000002");
        node[3].should.be.equal(8545);
        (await nodes.getNodePublicKey(0)).should.be.deep.equal(getPublicKey(nodeAddress));
        node[7].should.be.equal(0);

        const nodeId = stringKeccak256("d2");
        await nodes.nodesIPCheck("0x7f000001").should.be.eventually.true;
        await nodes.nodesNameCheck(nodeId).should.be.eventually.true;
        const nodeByName = await nodes.nodes(await nodes.nodesNameToIndex(nodeId));
        node.should.be.deep.equal(nodeByName);
        await nodes.isNodeExist(nodeAddress.address, 0).should.be.eventually.true;
        // const activeNodes = await nodes.connect(nodeAddress).getActiveNodesByAddress();
        // activeNodes.should.be.deep.equal([BigNumber.from(0)]);
        // expect(await nodes.getActiveNodesByAddress()).to.be.empty;
        (await nodes.numberOfActiveNodes()).should.be.equal(1);
        (await nodes.getNumberOfNodes()).should.be.equal(1);
    });

    describe("when a node is added", () => {
        fastBeforeEach(async () => {
            await nodes.createNode(
                nodeAddress.address,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000001",
                    publicIp: "0x7f000002",
                    publicKey: getPublicKey(nodeAddress),
                    name: "d2",
                    domainName: "some.domain.name"
                });
        });

        it("should set node as leaving", async () => {
            await nodes.initExit(0);

            (await nodes.numberOfActiveNodes()).should.be.equal(0);
            (await nodes.numberOfLeavingNodes()).should.be.equal(1);
        });

        it("should set node as left one", async () => {
            await nodes.initExit(0);
            await nodes.completeExit(0);

            await nodes.nodesIPCheck("0x7f000001").should.be.eventually.false;
            await nodes.nodesNameCheck(stringKeccak256("d2")).should.be.eventually.false;

            (await nodes.numberOfActiveNodes()).should.be.equal(0);
            (await nodes.numberOfLeftNodes()).should.be.equal(1);
        });

        it("should change node last reward date", async () => {
            await skipTime(5);
            const res = await(await nodes.changeNodeLastRewardDate(0)).wait();
            if (!res?.blockNumber) {
                throw new Error();
            }
            const currentTimeLocal = (await ethers.provider.getBlock(res.blockNumber))?.timestamp;

            (await nodes.nodes(0))[5].should.be.equal(currentTimeLocal);
            (await nodes.getNodeLastRewardDate(0)).should.be.equal(currentTimeLocal);
        });

        it("should get ip address of Node", async () => {
            await nodes.getNodeIP(0).should.be.eventually.equal("0x7f000001");
        });

        it("should get ip node's port", async () => {
            (await nodes.getNodePort(0)).should.be.equal(8545);
        });

        it("should get address of a node", async () => {
            (await nodes.getNodeAddress(0)).should.be.equal(nodeAddress.address);
        });

        it("should check if node status is active", async () => {
            await nodes.isNodeActive(0).should.be.eventually.true;
        });

        it("should check if node status is leaving", async () => {
            await nodes.isNodeLeaving(0).should.be.eventually.false;
        });

        it("should check if node status is left", async () => {
            await nodes.isNodeLeft(0).should.be.eventually.false;
        });

        it("should check node domain name", async () => {
            const nodeDomainName = await nodes.getNodeDomainName(0);
            nodeDomainName.should.be.equal("some.domain.name");
        });

        it("should modify node domain name by node owner", async () => {
            await nodes.connect(nodeAddress).setDomainName(0, "new.domain.name");
            const nodeDomainName = await nodes.getNodeDomainName(0);
            nodeDomainName.should.be.equal("new.domain.name");
        });

        it("should modify node domain name by validator", async () => {
            await nodes.connect(validator).setDomainName(0, "new.domain.name");
            const nodeDomainName = await nodes.getNodeDomainName(0);
            nodeDomainName.should.be.equal("new.domain.name");
        });

        it("should modify node domain name by contract owner", async () => {
            await nodes.setDomainName(0, "new.domain.name");
            const nodeDomainName = await nodes.getNodeDomainName(0);
            nodeDomainName.should.be.equal("new.domain.name");
        });

        it("should modify node domain name by NODE_MANAGER_ROLE", async () => {
            const NODE_MANAGER_ROLE = await nodes.NODE_MANAGER_ROLE();
            await nodes.grantRole(NODE_MANAGER_ROLE, admin.address);
            await nodes.connect(admin).setDomainName(0, "new.domain.name");
            const nodeDomainName = await nodes.getNodeDomainName(0);
            nodeDomainName.should.be.equal("new.domain.name");
        });

        it("should not modify node domain name by hacker", async () => {
            await nodes.connect(hacker).setDomainName(0, "new.domain.name")
                .should.be.revertedWithCustomError(validatorService, "ValidatorAddressDoesNotExist")
                .withArgs(hacker);
        });

        // it("should get array of ips of active nodes", async () => {
        //     const activeNodes = await nodes.getActiveNodeIPs();

        //     activeNodes.length.should.be.equal(1);
        //     activeNodes[0].should.be.equal("0x7f000001");
        // });

        // it("should get array of indexes of active nodes", async () => {
        //     const activeNodes = await nodes.getActiveNodeIds();

        //     activeNodes.length.should.be.equal(1);
        //     const nodeIndex = activeNodes[0];
        //     nodeIndex.should.be.equal(0);
        // });

        // it("should get array of indexes of active nodes of msg.sender", async () => {
        //     const activeNodes = await nodes.connect(nodeAddress).getActiveNodesByAddress();

        //     activeNodes.length.should.be.equal(1);
        //     const nodeIndex = activeNodes[0];
        //     nodeIndex.should.be.equal(0);
        // });

        it("should return Node status", async () => {
            let status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
            await nodes.initExit(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 1n);
        });

        it("should set node status In Maintenance from node address", async () => {
            let status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
            await nodes.connect(nodeAddress).setNodeInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 3n);
            const boolStatus = await nodes.isNodeInMaintenance(0);
            assert.equal(boolStatus, true);
        });

        it("should set node status From In Maintenance from node address", async () => {
            let status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
            await nodes.connect(nodeAddress).setNodeInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 3n);
            const boolStatus = await nodes.isNodeInMaintenance(0);
            assert.equal(boolStatus, true);

            await nodes.connect(nodeAddress).removeNodeFromInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
        });

        it("should set node status In Maintenance from validator address", async () => {
            let status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
            await nodes.connect(validator).setNodeInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 3n);
            const boolStatus = await nodes.isNodeInMaintenance(0);
            assert.equal(boolStatus, true);
        });

        it("should set node status From In Maintenance from validator address", async () => {
            let status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
            await nodes.connect(validator).setNodeInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 3n);
            const boolStatus = await nodes.isNodeInMaintenance(0);
            assert.equal(boolStatus, true);

            await nodes.connect(validator).removeNodeFromInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
        });

        it("should set node status In Maintenance from NODE_MANAGER_ROLE", async () => {
            const NODE_MANAGER_ROLE = await nodes.NODE_MANAGER_ROLE();
            await nodes.grantRole(NODE_MANAGER_ROLE, admin.address);
            let status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
            await nodes.connect(admin).setNodeInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 3n);
            const boolStatus = await nodes.isNodeInMaintenance(0);
            assert.equal(boolStatus, true);
        });

        it("should set node status From In Maintenance from NODE_MANAGER_ROLE", async () => {
            const NODE_MANAGER_ROLE = await nodes.NODE_MANAGER_ROLE();
            await nodes.grantRole(NODE_MANAGER_ROLE, admin.address);
            let status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
            await nodes.connect(admin).setNodeInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 3n);
            const boolStatus = await nodes.isNodeInMaintenance(0);
            assert.equal(boolStatus, true);

            await nodes.connect(admin).removeNodeFromInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
        });

        it("should set node status In Maintenance from owner", async () => {
            let status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
            await nodes.setNodeInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 3n);
            const boolStatus = await nodes.isNodeInMaintenance(0);
            assert.equal(boolStatus, true);
        });

        it("should set node status From In Maintenance from owner", async () => {
            let status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
            await nodes.setNodeInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 3n);
            const boolStatus = await nodes.isNodeInMaintenance(0);
            assert.equal(boolStatus, true);

            await nodes.removeNodeFromInMaintenance(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
        });

        it("should node set node status In Maintenance from Leaving or Left", async () => {
            let status = await nodes.getNodeStatus(0);
            assert.equal(status, 0n);
            await nodes.initExit(0);
            status = await nodes.getNodeStatus(0);
            assert.equal(status, 1n);
            await nodes.setNodeInMaintenance(0)
                .should.be.revertedWithCustomError(nodes, "NodeIsNotActive")
                .withArgs(0);
            await nodes.completeExit(0);
            await nodes.setNodeInMaintenance(0)
                .should.be.revertedWithCustomError(nodes, "NodeIsNotActive")
                .withArgs(0);
        });

        it("should decrease number of active nodes after setting node in maintenance", async () => {
            const numberOfActiveNodes = await nodes.numberOfActiveNodes();
            await nodes.setNodeInMaintenance(0);
            const numberOfActiveNodesAfter = await nodes.numberOfActiveNodes();
            assert.equal(numberOfActiveNodesAfter, numberOfActiveNodes - 1n);
        });

        describe("when node is registered", () => {
            fastBeforeEach(async () => {
                await nodes.createNode(
                    nodeAddress.address,
                    {
                        port: 8545,
                        nonce: 0,
                        ip: "0x7f000003",
                        publicIp: "0x7f000004",
                        publicKey: getPublicKey(nodeAddress),
                        name: "d3",
                        domainName: "some.domain.name"
                    });
            });

            it("should remove node", async () => {
                (await nodes.getNumberOnlineNodes()).should.be.equal(2);
                await nodes.initExit(0);
                await nodes.completeExit(0);
                (await nodes.getNumberOnlineNodes()).should.be.equal(1);
            });

            it("should remove space from node", async () => {
                await nodes.removeSpaceFromNode(0, 2);

                (await nodes.spaceOfNodes(0))[0].should.be.equal(126);
            });

            it("should add space to full node", async () => {
                await nodes.removeSpaceFromNode(0, 2);

                (await nodes.spaceOfNodes(0))[0].should.be.equal(126);

                await nodes.addSpaceToNode(0, 3).should.be.eventually.rejectedWith("Incorrect place");
                await nodes.addSpaceToNode(0, 2);

                (await nodes.spaceOfNodes(0))[0].should.be.equal(128);
            });

            it("should get number of free full nodes", async () => {
                (await nodes.countNodesWithFreeSpace(1)).should.be.equal(2);
            });
        });
    });

    describe("when two nodes are added", () => {
        fastBeforeEach(async () => {
            await nodes.createNode(
                nodeAddress.address,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000001",
                    publicIp: "0x7f000001",
                    publicKey: getPublicKey(nodeAddress),
                    name: "d1",
                    domainName: "some.domain.name"
                });
            await nodes.createNode(
                nodeAddress.address,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000002",
                    publicIp: "0x7f000002",
                    publicKey: getPublicKey(nodeAddress),
                    name: "d2",
                    domainName: "some.domain.name"
                });
        });

        describe("when nodes are registered", () => {
            fastBeforeEach(async () => {
                await nodes.createNode(
                    nodeAddress.address,
                    {
                        port: 8545,
                        nonce: 0,
                        ip: "0x7f000003",
                        publicIp: "0x7f000003",
                        publicKey: getPublicKey(nodeAddress),
                        name: "d3",
                        domainName: "some.domain.name"
                    });
                await nodes.createNode(
                    nodeAddress.address,
                    {
                        port: 8545,
                        nonce: 0,
                        ip: "0x7f000004",
                        publicIp: "0x7f000004",
                        publicKey: getPublicKey(nodeAddress),
                        name: "d4",
                        domainName: "some.domain.name"
                    });
            });

            it("should remove first node", async () => {
                await nodes.initExit(0);
                await nodes.completeExit(0);
                (await nodes.getNumberOnlineNodes()).should.be.equal(3);
            });

            it("should remove second node", async () => {
                await nodes.initExit(1);
                await nodes.completeExit(1);
                (await nodes.getNumberOnlineNodes()).should.be.equal(3);
            });

            it("should not remove larger space from full node than its has", async () => {
                const nodesFillingBefore = await nodes.spaceOfNodes(0);
                const spaceBefore = nodesFillingBefore["0"];
                await nodes.removeSpaceFromNode(0, 129);
                const nodesFillingAfter = await nodes.spaceOfNodes(0);
                const spaceAfter = nodesFillingAfter["0"];
                parseInt(spaceBefore.toString(), 10).should.be.equal(parseInt(spaceAfter.toString(), 10));
            });
        });
    });
});
