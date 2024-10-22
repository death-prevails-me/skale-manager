import {ContractManager,
         DelegationController,
         SkaleToken,
         ValidatorService} from "../../typechain-types";

import {deployContractManager} from "../tools/deploy/contractManager";
import {nextMonth} from "../tools/time";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {deployDelegationController} from "../tools/deploy/delegation/delegationController";
import {deployValidatorService} from "../tools/deploy/delegation/validatorService";
import {deploySkaleToken} from "../tools/deploy/skaleToken";
import {State} from "../tools/types";
import {deploySkaleManagerMock} from "../tools/deploy/test/skaleManagerMock";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {makeSnapshot, applySnapshot} from "../tools/snapshot";

chai.should();
chai.use(chaiAsPromised);

describe("DelegationController (token state)", () => {
    let owner: SignerWithAddress;
    let holder: SignerWithAddress;
    let validator: SignerWithAddress;
    let contractManager: ContractManager;
    let delegationController: DelegationController;
    let validatorService: ValidatorService;
    let skaleToken: SkaleToken;
    let snapshot: number;

    let validatorId: number;

    before(async () => {
        [owner, holder, validator] = await ethers.getSigners();

        contractManager = await deployContractManager();
        delegationController = await deployDelegationController(contractManager);
        validatorService = await deployValidatorService(contractManager);
        skaleToken = await deploySkaleToken(contractManager);

        const skaleManagerMock = await deploySkaleManagerMock(contractManager);
        await contractManager.setContractsAddress("SkaleManager", skaleManagerMock);

        await validatorService.connect(validator).registerValidator("Validator", "D2 is even", 150, 0);
        validatorId = 1;
        await skaleToken.mint(holder.address, 1000, "0x", "0x");
        const VALIDATOR_MANAGER_ROLE = await validatorService.VALIDATOR_MANAGER_ROLE();
        await validatorService.grantRole(VALIDATOR_MANAGER_ROLE, owner.address);
        await validatorService.enableValidator(validatorId);
    });

    beforeEach(async () => {
        snapshot = await makeSnapshot();
    });

    afterEach(async () => {
        await applySnapshot(snapshot);
    });

    it("should not lock tokens by default", async () => {
        (await delegationController.getAndUpdateLockedAmount.staticCall(holder.address)).should.be.equal(0);
        (await delegationController.getAndUpdateDelegatedAmount.staticCall(holder.address)).should.be.equal(0);
    });

    it("should not allow to get state of non existing delegation", async () => {
        await delegationController.getState("0xd2")
            .should.be.eventually.rejectedWith("Delegation does not exist");
    });

    describe("when delegation request is sent", () => {
        const amount = 100;
        const period = 2;
        const delegationId = 0;
        let cleanContracts: number;
        before(async () => {
            cleanContracts = await makeSnapshot();
            await delegationController.connect(holder).delegate(validatorId, amount, period, "INFO");
        });

        after(async () => {
            await applySnapshot(cleanContracts);
        });

        it("should be in `proposed` state", async () => {
            const returnedState = await delegationController.getState(delegationId);
            returnedState.should.be.equal(State.PROPOSED);
        });

        it("should automatically unlock tokens after delegation request if validator don't accept", async () => {
            await nextMonth(contractManager);

            const state = await delegationController.getState(delegationId);
            state.should.be.equal(State.REJECTED);
            const locked = await delegationController.getAndUpdateLockedAmount.staticCall(holder.address);
            locked.should.be.equal(0);
            const delegated = await delegationController.getAndUpdateDelegatedAmount.staticCall(holder.address);
            delegated.should.be.equal(0);
        });

        it("should allow holder to cancel delegation before acceptance", async () => {
            let locked = await delegationController.getAndUpdateLockedAmount.staticCall(holder.address);
            locked.should.be.equal(amount);
            let delegated = await delegationController.getAndUpdateDelegatedAmount.staticCall(holder.address);
            delegated.should.be.equal(0);

            await delegationController.connect(holder).cancelPendingDelegation(delegationId);

            const state = await delegationController.getState(delegationId);
            state.should.be.equal(State.CANCELED);
            locked = await delegationController.getAndUpdateLockedAmount.staticCall(holder.address);
            locked.should.be.equal(0);
            delegated = await delegationController.getAndUpdateDelegatedAmount.staticCall(holder.address);
            delegated.should.be.equal(0);
        });

        it("should not allow to accept request after end of the month", async () => {
            // skip month
            await nextMonth(contractManager);

            await delegationController.connect(validator).acceptPendingDelegation(delegationId)
                .should.eventually.be.rejectedWith("The delegation request is outdated");

            const state = await delegationController.getState(delegationId);
            state.should.be.equal(State.REJECTED);
            const locked = await delegationController.getAndUpdateLockedAmount.staticCall(holder.address);
            locked.should.be.equal(0);
            const delegated = await delegationController.getAndUpdateDelegatedAmount.staticCall(holder.address);
            delegated.should.be.equal(0);
        });

        describe("when delegation request is accepted", () => {
            let holderDelegatedToValidator: number;
            before(async () => {
                holderDelegatedToValidator = await makeSnapshot();
                await delegationController.connect(validator).acceptPendingDelegation(delegationId);
            });

            after(async () => {
                await applySnapshot(holderDelegatedToValidator);
            });

            it("should allow to move delegation from proposed to accepted state", async () => {
                const state = await delegationController.getState(delegationId);
                state.should.be.equal(State.ACCEPTED);
                const locked = await delegationController.getAndUpdateLockedAmount.staticCall(holder.address);
                locked.should.be.equal(amount);
                const delegated = await delegationController.getAndUpdateDelegatedAmount.staticCall(holder.address);
                delegated.should.be.equal(0);
            });

            it("should not allow to request undelegation while is not delegated", async () => {
                await delegationController.connect(holder).requestUndelegation(delegationId)
                    .should.be.eventually.rejectedWith("Cannot request undelegation");
            });

            it("should not allow to cancel accepted request", async () => {
                await delegationController.connect(holder).cancelPendingDelegation(delegationId)
                    .should.be.eventually.rejectedWith("Token holders are only able to cancel PROPOSED delegations");
            });

            describe("when 1 month was passed", () => {
                let validatorAcceptedDelegation: number;
                before(async () => {
                    validatorAcceptedDelegation = await makeSnapshot();
                    await nextMonth(contractManager);
                });

                after(async () => {
                    await applySnapshot(validatorAcceptedDelegation);
                });

                it("should become delegated", async () => {
                    const state = await delegationController.getState(delegationId);
                    state.should.be.equal(State.DELEGATED);
                    const locked = await delegationController.getAndUpdateLockedAmount.staticCall(holder.address);
                    locked.should.be.equal(amount);
                    const delegated = await delegationController.getAndUpdateDelegatedAmount.staticCall(holder.address);
                    delegated.should.be.equal(amount);
                });

                it("should allow to send undelegation request", async () => {
                    await delegationController.connect(holder).requestUndelegation(delegationId);

                    let state = await delegationController.getState(delegationId);
                    state.should.be.equal(State.UNDELEGATION_REQUESTED);
                    let locked = await delegationController.getAndUpdateLockedAmount.staticCall(holder.address);
                    locked.should.be.equal(amount);
                    let delegated = await delegationController.getAndUpdateDelegatedAmount.staticCall(holder.address);
                    delegated.should.be.equal(amount);

                    await nextMonth(contractManager, period);

                    state = await delegationController.getState(delegationId);
                    state.should.be.equal(State.COMPLETED);
                    locked = await delegationController.getAndUpdateLockedAmount.staticCall(holder.address);
                    locked.should.be.equal(0);
                    delegated = await delegationController.getAndUpdateDelegatedAmount.staticCall(holder.address);
                    delegated.should.be.equal(0);
                });
            });
        });
    });
});
