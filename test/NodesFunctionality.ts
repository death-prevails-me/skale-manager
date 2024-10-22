import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {ContractManager,
         Nodes,
         SkaleToken,
         ValidatorService,
         DelegationController,
         ConstantsHolder} from "../typechain-types";
import {privateKeys} from "./tools/private-keys";
import {getTransactionTimestamp, nextMonth} from "./tools/time";
import {Wallet} from "ethers";
import {deployContractManager} from "./tools/deploy/contractManager";
import {deployConstantsHolder} from "./tools/deploy/constantsHolder";
import {deployValidatorService} from "./tools/deploy/delegation/validatorService";
import {deployNodes} from "./tools/deploy/nodes";
import {deploySkaleToken} from "./tools/deploy/skaleToken";
import {deployDelegationController} from "./tools/deploy/delegation/delegationController";
import {deploySkaleManagerMock} from "./tools/deploy/test/skaleManagerMock";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {expect} from "chai";
import {getPublicKey, getValidatorIdSignature} from "./tools/signatures";
import {fastBeforeEach} from "./tools/mocha";


chai.should();
chai.use(chaiAsPromised);

describe("NodesFunctionality", () => {
    let owner: SignerWithAddress;
    let validator: SignerWithAddress;
    let nodeAddress: Wallet;
    let nodeAddress2: Wallet;
    let holder: SignerWithAddress;

    let contractManager: ContractManager;
    let nodes: Nodes;
    let validatorService: ValidatorService;
    let constantsHolder: ConstantsHolder;
    let skaleToken: SkaleToken;
    let delegationController: DelegationController;

    fastBeforeEach(async () => {
        [owner, validator, holder] = await ethers.getSigners();

        nodeAddress = new Wallet(String(privateKeys[2])).connect(ethers.provider);
        nodeAddress2 = new Wallet(String(privateKeys[3])).connect(ethers.provider);

        await owner.sendTransaction({to: nodeAddress.address, value: ethers.parseEther("10000")});
        await owner.sendTransaction({to: nodeAddress2.address, value: ethers.parseEther("10000")});

        contractManager = await deployContractManager();
        nodes = await deployNodes(contractManager);
        validatorService = await deployValidatorService(contractManager);
        constantsHolder = await deployConstantsHolder(contractManager);
        skaleToken = await deploySkaleToken(contractManager);
        delegationController = await deployDelegationController(contractManager);

        const skaleManagerMock = await deploySkaleManagerMock(contractManager);
        await contractManager.setContractsAddress("SkaleManager", skaleManagerMock);

        await validatorService.connect(validator).registerValidator("Validator", "D2", 0, 0);
        const validatorIndex = await validatorService.getValidatorId(validator.address);
        const signature1 = await getValidatorIdSignature(validatorIndex, nodeAddress);
        const signature2 = await getValidatorIdSignature(validatorIndex, nodeAddress2);
        await validatorService.connect(validator).linkNodeAddress(nodeAddress.address, signature1);
        await validatorService.connect(validator).linkNodeAddress(nodeAddress2.address, signature2);

        const NODE_MANAGER_ROLE = await nodes.NODE_MANAGER_ROLE();
        await nodes.grantRole(NODE_MANAGER_ROLE, owner.address);
    });

    it("should fail to create node if ip is zero", async () => {
        await nodes.createNode(
            nodeAddress.address,
            {
                port: 8545,
                nonce: 0,
                ip: "0x00000000",
                publicIp: "0x7f000001",
                publicKey: getPublicKey(nodeAddress),
                name: "D2",
                domainName: "some.domain.name"
            }).should.be.revertedWithCustomError(nodes, "IpIsNotAvailable")
                .withArgs("0x00000000");
    });

    it("should fail to create node if port is zero", async () => {
        await nodes.createNode(
            nodeAddress.address,
            {
                port: 0,
                nonce: 0,
                ip: "0x7f000001",
                publicIp: "0x7f000001",
                publicKey: getPublicKey(nodeAddress),
                name: "D2",
                domainName: "some.domain.name"
            }).should.be.revertedWithCustomError(nodes, "PortIsNotSet");
    });

    it("should fail to create node if public Key is incorrect", async () => {
        await nodes.createNode(
            validator.address,
            {
                port: 8545,
                nonce: 0,
                ip: "0x7f000001",
                publicIp: "0x7f000001",
                publicKey: getPublicKey(nodeAddress),
                name: "D2",
                domainName: "some.domain.name"
            }).should.be.revertedWithCustomError(nodes, "PublicKeyIsIncorrect")
                .withArgs(getPublicKey(nodeAddress));
    });

    it("should create node", async () => {
        await nodes.createNode(
            nodeAddress.address,
            {
                port: 8545,
                nonce: 0,
                ip: "0x7f000001",
                publicIp: "0x7f000001",
                publicKey: getPublicKey(nodeAddress),
                name: "D2",
                domainName: "some.domain.name"
            });

        const node = await nodes.nodes(0);
        node[0].should.be.equal("D2");
        node[1].should.be.equal("0x7f000001");
        node[2].should.be.equal("0x7f000001");
        node[3].should.be.equal(8545);
        (await nodes.getNodePublicKey(0)).should.be.deep.equal(getPublicKey(nodeAddress));
    });

    describe("when node is created", () => {
        const nodeId = 0;
        fastBeforeEach(async () => {
            await nodes.createNode(
                nodeAddress.address,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000001",
                    publicIp: "0x7f000001",
                    publicKey: getPublicKey(nodeAddress),
                    name: "D2",
                    domainName: "some.domain.name"
                });
        });

        it("should fail to delete non active node", async () => {
            await nodes.completeExit(0)
                .should.be.revertedWithCustomError(nodes, "NodeIsNotLeaving")
                .withArgs(0);
        });

        it("should delete node", async () => {
            await nodes.initExit(0);
            await nodes.completeExit(0);

            (await nodes.numberOfActiveNodes()).should.be.equal(0);
        });

        it("should initiate exiting", async () => {
            await nodes.initExit(0);

            (await nodes.numberOfActiveNodes()).should.be.equal(0);
        });

        it("should complete exiting", async () => {
            await nodes.completeExit(0)
                .should.be.revertedWithCustomError(nodes, "NodeIsNotLeaving")
                .withArgs(0);

            await nodes.initExit(0);

            await nodes.completeExit(0);
        });

        it("should change IP", async () => {
            await nodes.connect(holder).changeIP(0, "0x7f000001", "0x00000000").should.be.eventually.rejectedWith("Caller is not an admin");
            await nodes.connect(owner).changeIP(0, "0x7f000001", "0x00000000")
                .should.be.revertedWithCustomError(nodes, "IpIsNotAvailable")
                .withArgs("0x7f000001");
            await nodes.connect(owner).changeIP(0, "0x00000000", "0x00000000")
                .should.be.revertedWithCustomError(nodes, "IpIsNotAvailable")
                .withArgs("0x00000000");
            await nodes.connect(owner).changeIP(0, "0x7f000002", "0x7f000001")
                .should.be.revertedWithCustomError(nodes, "IpAndPublicIpIsDifferent")
                .withArgs("0x7f000002", "0x7f000001");
            expect(await nodes.getNodeIP(0)).to.equal("0x7f000001");
            expect(await nodes.nodesIPCheck("0x7f000001")).to.equal(true);
            expect(await nodes.nodesIPCheck("0x7f000002")).to.equal(false);
            await nodes.connect(owner).changeIP(0, "0x7f000002", "0x00000000");
            expect(await nodes.getNodeIP(0)).to.equal("0x7f000002");
            expect(await nodes.nodesIPCheck("0x7f000001")).to.equal(false);
            expect(await nodes.nodesIPCheck("0x7f000002")).to.equal(true);
            expect(await nodes.nodesIPCheck("0x7f000003")).to.equal(false);
            await nodes.connect(owner).changeIP(0, "0x7f000003", "0x00000000");
            expect(await nodes.getNodeIP(0)).to.equal("0x7f000003");
            expect(await nodes.nodesIPCheck("0x7f000001")).to.equal(false);
            expect(await nodes.nodesIPCheck("0x7f000002")).to.equal(false);
            expect(await nodes.nodesIPCheck("0x7f000003")).to.equal(true);
            await nodes.connect(owner).changeIP(0, "0x7f000001", "0x00000000");
            expect(await nodes.getNodeIP(0)).to.equal("0x7f000001");
            expect(await nodes.nodesIPCheck("0x7f000001")).to.equal(true);
            expect(await nodes.nodesIPCheck("0x7f000002")).to.equal(false);
            expect(await nodes.nodesIPCheck("0x7f000003")).to.equal(false);
            await nodes.connect(owner).changeIP(0, "0x7f000002", "0x7f000002");
            expect(await nodes.getNodeIP(0)).to.equal("0x7f000002");
            const res = await nodes.nodes(0);
            expect(res.publicIP).to.equal("0x7f000002");
            expect(await nodes.nodesIPCheck("0x7f000001")).to.equal(false);
            expect(await nodes.nodesIPCheck("0x7f000002")).to.equal(true);
            expect(await nodes.nodesIPCheck("0x7f000003")).to.equal(false);
        });

        it("should mark node as incompliant", async () => {
            await nodes.setNodeIncompliant(nodeId)
                .should.be.revertedWithCustomError(nodes, "RoleRequired")
                .withArgs(await nodes.COMPLIANCE_ROLE());
            await nodes.grantRole(await nodes.COMPLIANCE_ROLE(), owner.address);

            (await nodes.incompliant(nodeId)).should.be.equal(false);
            await nodes.setNodeIncompliant(nodeId);
            (await nodes.incompliant(nodeId)).should.be.equal(true);
        });

        it("should mark node as compliant", async () => {
            await nodes.grantRole(await nodes.COMPLIANCE_ROLE(), owner.address);
            await nodes.setNodeIncompliant(nodeId);

            (await nodes.incompliant(nodeId)).should.be.equal(true);
            await nodes.setNodeCompliant(nodeId);
            (await nodes.incompliant(nodeId)).should.be.equal(false);
        });
    });

    describe("when two nodes are created", () => {
        fastBeforeEach(async () => {
            await nodes.createNode(
                nodeAddress.address,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000001",
                    publicIp: "0x7f000001",
                    publicKey: getPublicKey(nodeAddress),
                    name: "D2",
                    domainName: "some.domain.name"
                }); // name
            await nodes.createNode(
                nodeAddress2.address,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000002",
                    publicIp: "0x7f000002",
                    publicKey: getPublicKey(nodeAddress2),
                    name: "D3",
                    domainName: "some.domain.name"
                }); // name
        });

        it("should delete first node", async () => {
            await nodes.initExit(0);
            await nodes.completeExit(0);

            (await nodes.numberOfActiveNodes()).should.be.equal(1);
        });

        it("should delete second node", async () => {
            await nodes.initExit(1);
            await nodes.completeExit(1);

            (await nodes.numberOfActiveNodes()).should.be.equal(1);
        });

        it("should initiate exit from first node", async () => {
            await nodes.initExit(0);

            (await nodes.numberOfActiveNodes()).should.be.equal(1);
        });

        it("should initiate exit from second node", async () => {
            await nodes.initExit(1);

            (await nodes.numberOfActiveNodes()).should.be.equal(1);
        });

        it("should complete exiting from first node", async () => {
            await nodes.completeExit(0)
                .should.be.revertedWithCustomError(nodes, "NodeIsNotLeaving")
                .withArgs(0);

            await nodes.initExit(0);

            await nodes.completeExit(0);
        });

        it("should complete exiting from second node", async () => {
            await nodes.completeExit(1)
                .should.be.revertedWithCustomError(nodes, "NodeIsNotLeaving")
                .withArgs(1);

            await nodes.initExit(1);

            await nodes.completeExit(1);
        });

        it("should change IP", async () => {
            await nodes.connect(holder).changeIP(0, "0x7f000001", "0x00000000").should.be.eventually.rejectedWith("Caller is not an admin");
            await nodes.connect(owner).changeIP(0, "0x7f000001", "0x00000000")
                .should.be.revertedWithCustomError(nodes, "IpIsNotAvailable")
                .withArgs("0x7f000001");
            await nodes.connect(owner).changeIP(0, "0x00000000", "0x00000000")
                .should.be.revertedWithCustomError(nodes, "IpIsNotAvailable")
                .withArgs("0x00000000");
            await nodes.connect(owner).changeIP(0, "0x7f000002", "0x00000000")
                .should.be.revertedWithCustomError(nodes, "IpIsNotAvailable")
                .withArgs("0x7f000002");
            await nodes.connect(owner).changeIP(0, "0x7f000003", "0x7f000002")
                .should.be.revertedWithCustomError(nodes, "IpAndPublicIpIsDifferent")
                .withArgs("0x7f000003", "0x7f000002");
            await nodes.connect(holder).changeIP(1, "0x7f000002", "0x00000000").should.be.eventually.rejectedWith("Caller is not an admin");
            await nodes.connect(owner).changeIP(1, "0x7f000002", "0x00000000")
                .should.be.revertedWithCustomError(nodes, "IpIsNotAvailable")
                .withArgs("0x7f000002");
            await nodes.connect(owner).changeIP(1, "0x00000000", "0x00000000")
                .should.be.revertedWithCustomError(nodes, "IpIsNotAvailable")
                .withArgs("0x00000000");
            await nodes.connect(owner).changeIP(1, "0x7f000001", "0x00000000")
                .should.be.revertedWithCustomError(nodes, "IpIsNotAvailable")
                .withArgs("0x7f000001");
            await nodes.connect(owner).changeIP(0, "0x7f000004", "0x7f000002")
                .should.be.revertedWithCustomError(nodes, "IpAndPublicIpIsDifferent")
                .withArgs("0x7f000004", "0x7f000002");
            expect(await nodes.getNodeIP(0)).to.equal("0x7f000001");
            expect(await nodes.nodesIPCheck("0x7f000001")).to.equal(true);
            expect(await nodes.nodesIPCheck("0x7f000002")).to.equal(true);
            expect(await nodes.nodesIPCheck("0x7f000003")).to.equal(false);
            await nodes.connect(owner).changeIP(0, "0x7f000003", "0x00000000");
            expect(await nodes.getNodeIP(0)).to.equal("0x7f000003");
            expect(await nodes.nodesIPCheck("0x7f000001")).to.equal(false);
            expect(await nodes.nodesIPCheck("0x7f000002")).to.equal(true);
            expect(await nodes.nodesIPCheck("0x7f000003")).to.equal(true);
            await nodes.connect(owner).changeIP(1, "0x7f000001", "0x00000000");
            expect(await nodes.getNodeIP(1)).to.equal("0x7f000001");
            expect(await nodes.nodesIPCheck("0x7f000001")).to.equal(true);
            expect(await nodes.nodesIPCheck("0x7f000002")).to.equal(false);
            expect(await nodes.nodesIPCheck("0x7f000003")).to.equal(true);
            await nodes.connect(owner).changeIP(0, "0x7f000002", "0x00000000");
            expect(await nodes.getNodeIP(0)).to.equal("0x7f000002");
            expect(await nodes.nodesIPCheck("0x7f000001")).to.equal(true);
            expect(await nodes.nodesIPCheck("0x7f000002")).to.equal(true);
            expect(await nodes.nodesIPCheck("0x7f000003")).to.equal(false);
            await nodes.connect(owner).changeIP(1, "0x7f000003", "0x7f000003");
            expect(await nodes.getNodeIP(1)).to.equal("0x7f000003");
            const res = await nodes.nodes(1);
            expect(res.publicIP).to.equal("0x7f000003");
            expect(await nodes.nodesIPCheck("0x7f000001")).to.equal(false);
            expect(await nodes.nodesIPCheck("0x7f000002")).to.equal(true);
            expect(await nodes.nodesIPCheck("0x7f000003")).to.equal(true);
        });

        it("should store last change ip time", async () => {
            const nodeIndex = 0;
            const tx = await nodes.connect(owner).changeIP(nodeIndex, "0x7f000003", "0x00000000");
            const transactionTimestamp = await getTransactionTimestamp(tx.hash);
            const lastChangeIpTime = await nodes.getLastChangeIpTime(nodeIndex);
            expect(lastChangeIpTime).to.equal(transactionTimestamp);
        });
    });

    describe("when holder has enough tokens", () => {
        const validatorId = 1;
        let amount: number;
        let delegationPeriod: number;
        let info: string;
        fastBeforeEach(async () => {
            amount = 100;
            delegationPeriod = 2;
            info = "NICE";
            await skaleToken.mint(holder.address, 200, "0x", "0x");
            await skaleToken.mint(nodeAddress.address, 200, "0x", "0x");
            const CONSTANTS_HOLDER_MANAGER_ROLE = await constantsHolder.CONSTANTS_HOLDER_MANAGER_ROLE();
            await constantsHolder.grantRole(CONSTANTS_HOLDER_MANAGER_ROLE, owner.address);
            await constantsHolder.setMSR(amount * 5);
            const VALIDATOR_MANAGER_ROLE = await validatorService.VALIDATOR_MANAGER_ROLE();
            await validatorService.grantRole(VALIDATOR_MANAGER_ROLE, owner.address);
        });

        it("should not allow to create node if new epoch isn't started", async () => {
            await validatorService.enableValidator(validatorId);
            await delegationController.connect(holder).delegate(validatorId, amount, delegationPeriod, info);
            const delegationId = 0;
            await delegationController.connect(validator).acceptPendingDelegation(delegationId);

            await nodes.checkPossibilityCreatingNode(nodeAddress.address)
                .should.be.revertedWithCustomError(nodes, "MinimumStakingRequirementIsNotMet");
        });

        it("should allow to create node if new epoch is started", async () => {
            await validatorService.enableValidator(validatorId);
            await delegationController.connect(holder).delegate(validatorId, amount, delegationPeriod, info);
            const delegationId = 0;
            await delegationController.connect(validator).acceptPendingDelegation(delegationId);
            await nextMonth(contractManager);

            await nodes.checkPossibilityCreatingNode(nodeAddress.address)
                .should.be.revertedWithCustomError(nodes, "MinimumStakingRequirementIsNotMet");

            await constantsHolder.setMSR(amount);

            // now it should not reject
            await nodes.checkPossibilityCreatingNode(nodeAddress.address);

            await nodes.createNode(
                nodeAddress.address,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000001",
                    publicIp: "0x7f000001",
                    publicKey: getPublicKey(nodeAddress),
                    name: "D2",
                    domainName: "some.domain.name"
                });
            const nodeIndex = (await nodes.getValidatorNodeIndexes(validatorId))[0];
            nodeIndex.should.be.equal(0);
        });

        it("should allow to create 2 nodes", async () => {
            const validator3 = nodeAddress;
            await validatorService.enableValidator(validatorId);
            await delegationController.connect(holder).delegate(validatorId, amount, delegationPeriod, info);
            const delegationId1 = 0;
            await delegationController.connect(validator).acceptPendingDelegation(delegationId1);
            await delegationController.connect(validator3).delegate(validatorId, amount, delegationPeriod, info);
            const delegationId2 = 1;
            await delegationController.connect(validator).acceptPendingDelegation(delegationId2);

            await nextMonth(contractManager);
            await nodes.checkPossibilityCreatingNode(nodeAddress.address)
                .should.be.revertedWithCustomError(nodes, "MinimumStakingRequirementIsNotMet");

            await constantsHolder.setMSR(amount);

            await nodes.checkPossibilityCreatingNode(nodeAddress.address);
            await nodes.createNode(
                nodeAddress.address,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000001",
                    publicIp: "0x7f000001",
                    publicKey: getPublicKey(nodeAddress),
                    name: "D2",
                    domainName: "some.domain.name"
                });

            await nodes.checkPossibilityCreatingNode(nodeAddress.address);
            await nodes.createNode(
                nodeAddress.address,
                {
                    port: 8545,
                    nonce: 0,
                    ip: "0x7f000002",
                    publicIp: "0x7f000002",
                    publicKey: getPublicKey(nodeAddress),
                    name: "D3",
                    domainName: "some.domain.name"
                });

            const nodeIndexesBN = (await nodes.getValidatorNodeIndexes(validatorId));
            for (let i = 0; i < nodeIndexesBN.length; i++) {
                const nodeIndex = (await nodes.getValidatorNodeIndexes(validatorId))[i];
                nodeIndex.should.be.equal(i);
            }
        });
    });
});
