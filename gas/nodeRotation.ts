import {deployContractManager} from "../test/tools/deploy/contractManager";
import {deployValidatorService} from "../test/tools/deploy/delegation/validatorService";
import {deploySkaleManager} from "../test/tools/deploy/skaleManager";
import {
    ContractManager,
    Nodes,
    Schains,
    SchainsInternalMock,
    SkaleDKGTester,
    SkaleManager,
    ValidatorService
} from "../typechain-types";
import {privateKeys} from "../test/tools/private-keys";
import {deploySchains} from "../test/tools/deploy/schains";
import {deploySchainsInternalMock} from "../test/tools/deploy/test/schainsInternalMock";
import {deploySkaleDKGTester} from "../test/tools/deploy/test/skaleDKGTester";
import {skipTime} from "../test/tools/time";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {ethers} from "hardhat";
import {Wallet} from "ethers";
import fs from 'fs';
import {getPublicKey, getValidatorIdSignature} from "../test/tools/signatures";
import {stringKeccak256} from "../test/tools/hashes";
import {fastBeforeEach} from "../test/tools/mocha";
import {SchainType} from "../test/tools/types";
import {applySnapshot, makeSnapshot} from "../test/tools/snapshot";
import {deployNodes} from "../test/tools/deploy/nodes";
import {findEvent} from "./createSchain";


describe("nodeRotation", () => {
    let owner: SignerWithAddress;
    let validator: SignerWithAddress;
    let node: Wallet;

    let contractManager: ContractManager;
    let validatorService: ValidatorService;
    let skaleManager: SkaleManager;
    let schains: Schains;
    let schainsInternal: SchainsInternalMock;
    let skaleDKG: SkaleDKGTester;
    let nodes: Nodes;

    before(async () => {
        [owner, validator] = await ethers.getSigners();
            node = new Wallet(String(privateKeys[3])).connect(ethers.provider);
            await owner.sendTransaction({value: ethers.parseEther("1"), to: node.address});

            contractManager = await deployContractManager();
            schainsInternal = await deploySchainsInternalMock(contractManager);
            await contractManager.setContractsAddress("SchainsInternal", schainsInternal.getAddress());
            skaleDKG = await deploySkaleDKGTester(contractManager);

            validatorService = await deployValidatorService(contractManager);
            skaleManager = await deploySkaleManager(contractManager);
            schains = await deploySchains(contractManager);
            nodes = await deployNodes(contractManager);
            await contractManager.setContractsAddress("SkaleDKG", skaleDKG.getAddress());

            await validatorService.grantRole(await validatorService.VALIDATOR_MANAGER_ROLE(), owner.address);
            await nodes.grantRole(await nodes.NODE_MANAGER_ROLE(), owner.address);
            await validatorService.disableWhitelist();
    })

    describe("Tests without memory", () => {
        fastBeforeEach(() => Promise.resolve(undefined));

        it("64 node rotations on 17 nodes", async () => {
            const validatorId = 1;

            await validatorService.connect(validator).registerValidator("Validator", "", 0, 0);
            const signature = await getValidatorIdSignature(validatorId, node);
            await validatorService.connect(validator).linkNodeAddress(node.address, signature);
            await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), owner.address);

            const nodesAmount = 16;
            for (let nodeId = 0; nodeId < nodesAmount; ++nodeId) {
                await skaleManager.connect(node).createNode(
                    1, // port
                    0, // nonce
                    "0x7f" + ("000000" + nodeId.toString(16)).slice(-6), // ip
                    "0x7f" + ("000000" + nodeId.toString(16)).slice(-6), // public ip
                    getPublicKey(node), // public key
                    `d2-${nodeId}`, // name)
                    "some.domain.name"
                );
            }

            const numberOfSchains = 64;
            for (let schainNumber = 0; schainNumber < numberOfSchains; schainNumber++) {
                const result = await (await schains.addSchainByFoundation(0, SchainType.SMALL, 0, `schain-${schainNumber}`, owner.address, ethers.ZeroAddress, [])).wait();
                await skaleDKG.setSuccessfulDKGPublic(stringKeccak256(`schain-${schainNumber}`));
                console.log("create", schainNumber + 1, "schain on", nodesAmount, "nodes:\t", result?.gasUsed, "gu");
            }

            await skaleManager.connect(node).createNode(
                1, // port
                0, // nonce
                "0x7f" + ("000000" + Number(16).toString(16)).slice(-6), // ip
                "0x7f" + ("000000" + Number(16).toString(16)).slice(-6), // public ip
                getPublicKey(node), // public key
                "d2-16", // name)
                "some.domain.name"
            );

            const gasLimit = 12e6;
            const rotIndex = Math.floor(Math.random() * nodesAmount);
            const schainHashes = await schainsInternal.getActiveSchains(rotIndex);
            console.log("Rotation for node", rotIndex);
            console.log("Will process", schainHashes.length, "rotations");
            const gas = [];
            await nodes.initExit(rotIndex);
            for (let i = 0; i < schainHashes.length; i++) {
                const estimatedGas = await skaleManager.connect(node).nodeExit.estimateGas(rotIndex);
                console.log("Estimated gas on nodeExit", estimatedGas.toString());
                const overrides = {
                    gasLimit: estimatedGas
                }
                const result = await (await skaleManager.connect(node).nodeExit(rotIndex, overrides)).wait();
                if (!result) {
                    throw new Error();
                }
                // console.log("Gas limit was:", result);
                console.log(`${i + 1}`, "Rotation on", nodesAmount, "nodes:\t", result?.gasUsed, "gu");
                gas.push(result?.gasUsed);
                if (result?.gasUsed > gasLimit) {
                    break;
                }
                await skaleDKG.setSuccessfulDKGPublic(
                    schainHashes[schainHashes.length - i - 1]
                );
            }
        });
    });

    describe("max node rotation on 17 nodes", () => {
        const validatorId = 1;
        const nodesAmount = 16;
        const numberOfSchains = 128;
        const gasLimit = 12e6;
        const leavingNode = Math.floor(Math.random() * nodesAmount);
        const gas = [];
        let schainHashes: string[];
        let stateBefore: number;

        before(async () => {
            stateBefore = await makeSnapshot();
            await validatorService.connect(validator).registerValidator("Validator", "", 0, 0);
            const signature = await getValidatorIdSignature(validatorId, node);
            await validatorService.connect(validator).linkNodeAddress(node.address, signature);
            await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), owner.address);

            for (let nodeId = 0; nodeId < nodesAmount; ++nodeId) {
                await skaleManager.connect(node).createNode(
                    1, // port
                    0, // nonce
                    "0x7f" + ("000000" + nodeId.toString(16)).slice(-6), // ip
                    "0x7f" + ("000000" + nodeId.toString(16)).slice(-6), // public ip
                    getPublicKey(node), // public key
                    `d2-${nodeId}`, // name)
                    "some.domain.name"
                );
            }

            for (let schainNumber = 0; schainNumber < numberOfSchains; schainNumber++) {
                const result = await (await schains.addSchainByFoundation(0, SchainType.SMALL, 0, `schain-${schainNumber}`, owner.address, ethers.ZeroAddress, [])).wait();
                const nodeInGroup = findEvent(result, "SchainNodes").args?.nodesInGroup;
                    console.log("Nodes in Schain:");
                    const setOfNodes = new Set();
                    for (const nodeOfSchain of nodeInGroup) {
                        if (!setOfNodes.has(nodeOfSchain.toNumber())) {
                            setOfNodes.add(nodeOfSchain.toNumber());
                        } else {
                            console.log("Node", nodeOfSchain.toNumber(), "already exist");
                            process.exit();
                        }
                        console.log(nodeOfSchain.toNumber());
                    }
                await skaleDKG.setSuccessfulDKGPublic(stringKeccak256(`schain-${schainNumber}`));
                console.log("create", schainNumber + 1, "schain on", nodesAmount, "nodes:\t", result?.gasUsed, "gu");
            }

            await skaleManager.connect(node).createNode(
                1, // port
                0, // nonce
                "0x7f" + ("000000" + Number(16).toString(16)).slice(-6), // ip
                "0x7f" + ("000000" + Number(16).toString(16)).slice(-6), // public ip
                getPublicKey(node), // public key
                "d2-16", // name)
                "some.domain.name"
            );

            schainHashes = await schainsInternal.getActiveSchains(leavingNode);
            await nodes.initExit(leavingNode);
        });

        for(let test = 1; test <= numberOfSchains; ++test) {
            it(`should exit schain #${test}`, async () => {
                if (await ethers.provider.getBalance(node) < ethers.parseEther("0.1")) {
                    await owner.sendTransaction({value: ethers.parseEther("1"), to: node.address});
                }

                const estimatedGas = await skaleManager.nodeExit.estimateGas(leavingNode);
                const overrides = {
                    gasLimit: estimatedGas * 11n / 10n
                }
                console.log("Estimated gas on nodeExit", overrides.gasLimit);
                const result = await (await skaleManager.connect(node).nodeExit(leavingNode, overrides)).wait();
                if (!result) {
                    throw new Error();
                }
                // console.log("Gas limit was:", result);
                console.log(`${test}`, "Rotation on", nodesAmount, "nodes:\t", result.gasUsed, "gu");
                gas.push(result.gasUsed);
                if (result.gasUsed > gasLimit) {
                    return;
                }
                await skaleDKG.setSuccessfulDKGPublic(
                    schainHashes[schainHashes.length - test]
                );
            });
        }

        after(async () => {
            await applySnapshot(stateBefore);
        })
    });

    describe("random rotation on dynamically creating schains", () => {
        const validatorId = 1;

        const maxNodesAmount = 200;
        const gasLimit = 12e6;
        const measurementsSchainCreation: {nodesAmount: number, gasUsed: bigint}[] = [];
        const measurementsRotation = [];
        const activeNodes: number[] = [];

        let nodeId = 0;
        let nodesAmount: number;
        let stateBefore: number;

        before(async () => {
            stateBefore = await makeSnapshot();
            await validatorService.connect(validator).registerValidator("Validator", "", 0, 0);
            const signature = await getValidatorIdSignature(validatorId, node);
            await validatorService.connect(validator).linkNodeAddress(node.address, signature);
            await schains.grantRole(await schains.SCHAIN_CREATOR_ROLE(), owner.address);
        });

        beforeEach(async () => {
            if (await ethers.provider.getBalance(node) < ethers.parseEther("0.1")) {
                await owner.sendTransaction({value: ethers.parseEther("1"), to: node.address});
            }

            await skaleManager.connect(node).createNode(
                1, // port
                0, // nonce
                "0x7f" + ("000000" + nodeId.toString(16)).slice(-6), // ip
                "0x7f" + ("000000" + nodeId.toString(16)).slice(-6), // public ip
                getPublicKey(node), // public key
                `d2-${nodeId}`, // name)
                "some.domain.name"
            );

            activeNodes.push(nodeId);
            ++nodeId;
            nodesAmount = nodeId;
            if (nodesAmount >= 16) {
                const result = await (await schains.addSchainByFoundation(0, SchainType.SMALL, 0, `schain-${nodeId}`, owner.address, ethers.ZeroAddress, [])).wait();
                if (!result) {
                    throw new Error();
                }
                await skaleDKG.setSuccessfulDKGPublic(stringKeccak256(`schain-${nodeId}`));
                console.log("create schain on", nodesAmount, "nodes:\t", result.gasUsed, "gu");

                measurementsSchainCreation.push({nodesAmount, gasUsed: result.gasUsed});
                if (result.gasUsed > gasLimit) {
                    return;
                }
            }
        });

        for (let test = 1; test <= maxNodesAmount; ++test) {
            it(`should rotate on ${test} nodes`, async () => {
                if (nodesAmount >= 155) {
                    const randomIndex = Math.floor(Math.random() * activeNodes.length)
                    const leavingNode = activeNodes[randomIndex];
                    activeNodes[randomIndex] = activeNodes[activeNodes.length - 1];
                    activeNodes.pop();
                    const schainHashes = await schainsInternal.getActiveSchains(leavingNode);
                    console.log("Rotation for node", leavingNode);
                    console.log("Will process", schainHashes.length, "rotations");
                    const gas = [];
                    await nodes.initExit(leavingNode);
                    for (let i = 0; i < schainHashes.length; i++) {
                        if (await ethers.provider.getBalance(node) < ethers.parseEther("0.1")) {
                            await owner.sendTransaction({value: ethers.parseEther("1"), to: node.address});
                        }
                        const estimatedGas = await skaleManager.connect(node).nodeExit.estimateGas(leavingNode);
                        console.log("Estimated gas on nodeExit", estimatedGas.toString());
                        const overrides = {
                            gasLimit: estimatedGas
                        }
                        const result = await (await skaleManager.connect(node).nodeExit(leavingNode, overrides)).wait();
                        if (!result) {
                            throw new Error();
                        }
                        // console.log("Gas limit was:", result);
                        console.log(`${i + 1}`, "Rotation on", nodesAmount, "nodes:\t", result.gasUsed, "gu");
                        gas.push(result.gasUsed);
                        if (result.gasUsed > gasLimit) {
                            break;
                        }
                        await skaleDKG.setSuccessfulDKGPublic(
                            schainHashes[schainHashes.length - i - 1]
                        );
                    }
                    await skipTime(43260);
                    measurementsRotation.push({nodesAmount, gasUsedArray: gas});
                }
            });
        }

        after(async () => {
            fs.writeFileSync("nodeRotation.json", JSON.stringify(measurementsSchainCreation, null, 4));
            await applySnapshot(stateBefore);
        })
    });
});
