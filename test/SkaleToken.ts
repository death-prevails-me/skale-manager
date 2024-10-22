import {ContractManager,
    SkaleToken,
} from "../typechain-types";

import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {deployContractManager} from "./tools/deploy/contractManager";
import {deployValidatorService} from "./tools/deploy/delegation/validatorService";
import {deploySkaleToken} from "./tools/deploy/skaleToken";
import {deployReentrancyTester} from "./tools/deploy/test/reentrancyTester";
import {deploySkaleManagerMock} from "./tools/deploy/test/skaleManagerMock";
import {ethers} from "hardhat";
import {SignerWithAddress} from "@nomicfoundation/hardhat-ethers/signers";
import {expect} from "chai";
import {fastBeforeEach} from "./tools/mocha";

chai.should();
chai.use(chaiAsPromised);

describe("SkaleToken", () => {
  let owner: SignerWithAddress;
  let holder: SignerWithAddress;
  let receiver: SignerWithAddress;
  let nilAddress: SignerWithAddress;
  let accountWith99: SignerWithAddress;

  let skaleToken: SkaleToken;
  let contractManager: ContractManager;

  const TOKEN_CAP = 7000000000;
  const TOTAL_SUPPLY = 5000000000;

  fastBeforeEach(async () => {
    [owner, holder, receiver, nilAddress, accountWith99] = await ethers.getSigners();

    contractManager = await deployContractManager();

    contractManager = await deployContractManager();
    skaleToken = await deploySkaleToken(contractManager);

    const skaleManagerMock = await deploySkaleManagerMock(contractManager);
    await contractManager.setContractsAddress("SkaleManager", skaleManagerMock);

    const premined = "5000000000000000000000000000"; // 5e9 * 1e18
    await skaleToken.mint(owner.address, premined, "0x", "0x");
  });

  it("should have the correct name", async () => {
    const name = await skaleToken.NAME();
    expect(name).to.be.equal("SKALE");
  });

  it("should have the correct symbol", async () => {
    const symbol = await skaleToken.SYMBOL();
    expect(symbol).to.be.equal("SKL");
  });

  it("should have the correct decimal level", async () => {
    const decimals = await skaleToken.DECIMALS();
    expect(decimals).to.be.equal(18);
  });

  it("should return the capitalization of tokens for the Contract", async () => {
    const cap = await skaleToken.CAP();
    ethers.parseEther(TOKEN_CAP.toString()).should.be.equal(cap);
  });

  it("owner should be equal owner", async () => {
    await skaleToken.hasRole(await skaleToken.DEFAULT_ADMIN_ROLE(), owner.address).should.be.eventually.true;
  });

  it("the owner should have all the tokens when the Contract is created", async () => {
    const balance = await skaleToken.balanceOf(owner.address);
    balance.should.be.equal(ethers.parseEther(TOTAL_SUPPLY.toString()));
  });

  it("should return the total supply of tokens for the Contract", async () => {
    const supply = await skaleToken.totalSupply();
    supply.should.be.equal(ethers.parseEther(TOTAL_SUPPLY.toString()));
  });

  it("any account should have the tokens transferred to it", async () => {
    const amount = ethers.parseEther("10");
    await skaleToken.transfer(holder.address, amount);
    const balance = await skaleToken.balanceOf(holder.address);
    balance.should.be.equal(amount);
  });

  it("should not let someone transfer tokens they do not have", async () => {
    await skaleToken.transfer(holder.address, ethers.parseEther("10"));
    await skaleToken.connect(holder).transfer(receiver.address, ethers.parseEther("20")).should.be.eventually.rejected;
  });

  it("an address that has no tokens should return a balance of zero", async () => {
    const balance = await skaleToken.balanceOf(nilAddress.address);
    balance.should.be.equal(0);
  });

  it("an owner address should have more than 0 tokens", async () => {
    const balance = await skaleToken.balanceOf(owner.address);
    balance.should.be.equal(ethers.parseEther("5000000000"));
  });

  it("should emit a Transfer Event", async () => {
    const amount = ethers.parseEther("10");
    await expect(
      skaleToken.transfer(holder.address, amount)
    ).to.emit(skaleToken, 'Transfer')
      .withArgs(owner.address, holder.address, amount);
  });

  it("allowance should return the amount I allow them to transfer", async () => {
    const amount = ethers.parseEther("99");
    await skaleToken.approve(holder.address, amount);
    const remaining = await skaleToken.allowance(owner.address, holder.address);
    amount.should.be.equal(remaining);
  });

  it("allowance should return the amount another allows a third account to transfer", async () => {
    const amount = ethers.parseEther("98");
    await skaleToken.connect(holder).approve(receiver.address, amount);
    const remaining = await skaleToken.allowance(holder.address, receiver.address);
    amount.should.be.equal(remaining);
  });

  it("allowance should return zero if none have been approved for the account", async () => {
    const remaining = await skaleToken.allowance(owner.address, nilAddress.address);
    remaining.should.be.equal(0);
  });

  it("should emit an Approval event when the approve method is successfully called", async () => {
    const amount = ethers.parseEther("97");
    await expect(skaleToken.approve(holder.address, amount))
      .to.emit(skaleToken, 'Approval')
      .withArgs(owner.address, holder.address, amount);
  });

  it("holder balance should be bigger than 0 eth", async () => {
    const holderBalance = await ethers.provider.getBalance(holder.address);
    holderBalance.should.not.be.equal(0);
  });

  it("transferFrom should transfer tokens when triggered by an approved third party", async () => {
    const tokenAmount = 96;
    await skaleToken.approve(holder.address, tokenAmount);
    await skaleToken.connect(holder).transferFrom(owner.address, receiver.address, tokenAmount);
    const balance = await skaleToken.connect(receiver).balanceOf(receiver.address);
    balance.should.be.equal(tokenAmount);
  });

  it("the account funds are being transferred from should have sufficient funds", async () => {
    const balance99 = ethers.parseEther("99");
    await skaleToken.transfer(accountWith99.address, balance99);
    const balance = await skaleToken.balanceOf(accountWith99.address);
    balance99.should.be.equal(balance);
    const amount = ethers.parseEther("100");

    await skaleToken.connect(accountWith99).approve(receiver.address, amount);
    await skaleToken.connect(receiver).transferFrom(accountWith99.address, receiver.address, amount).should.be.eventually.rejected;
  });

  it("should throw exception when attempting to transferFrom unauthorized account", async () => {
    const remaining = await skaleToken.allowance(owner.address, nilAddress.address);
    remaining.should.be.equal(0);
    const holderBalance = await skaleToken.balanceOf(holder.address);
    holderBalance.should.be.equal(0);
    const amount = ethers.parseEther("101");

    await skaleToken.connect(nilAddress).transferFrom(owner.address, nilAddress.address, amount).should.be.eventually.rejected;
  });

  it("an authorized accounts allowance should go down when transferFrom is called", async () => {
    const amount = ethers.parseEther("15");
    await skaleToken.approve(holder.address, amount);
    let allowance = await skaleToken.allowance(owner.address, holder.address);
    amount.should.be.equal(allowance);
    await skaleToken.connect(holder).transferFrom(owner.address, holder.address, ethers.parseEther("7"));

    allowance = await skaleToken.allowance(owner.address, holder.address);
    ethers.parseEther("8").should.be.equal(allowance);
  });

  it("should emit a Transfer event when transferFrom is called", async () => {
    const amount = ethers.parseEther("17");
    await skaleToken.approve(holder.address, amount);

    await expect(skaleToken.connect(holder).transferFrom(owner.address, holder.address, amount))
      .to.emit(skaleToken, "Transfer")
      .withArgs(owner.address, holder.address, amount);
  });

  it("should emit a Minted Event", async () => {
    const amount = ethers.parseEther("10");
    await expect(skaleToken.mint(owner.address, amount, "0x", "0x"))
      .to.emit(skaleToken, "Minted")
      .withArgs(owner.address, owner.address, amount, "0x", "0x");
  });

  it("should emit a Burned Event", async () => {
    const amount = ethers.parseEther("10");
    await expect(skaleToken.burn(amount, "0x"))
      .to.emit(skaleToken, "Burned")
      .withArgs(owner.address, owner.address, amount, "0x", "0x");
  });

  it("should not allow reentrancy on transfers", async () => {
    const amount = 5;
    await skaleToken.mint(holder.address, amount, "0x", "0x");

    const reentrancyTester = await deployReentrancyTester(contractManager);
    await reentrancyTester.prepareToReentrancyCheck();

    await skaleToken.connect(holder).transfer(reentrancyTester, amount)
      .should.be.eventually.rejectedWith("ReentrancyGuard: reentrant call");

    (await skaleToken.balanceOf(holder.address)).should.be.equal(amount);
    (await skaleToken.balanceOf(skaleToken)).should.be.equal(0);
  });

  it("should not allow to delegate burned tokens", async () => {
    const reentrancyTester = await deployReentrancyTester(contractManager);
    const validatorService = await deployValidatorService(contractManager);

    const VALIDATOR_MANAGER_ROLE = await validatorService.VALIDATOR_MANAGER_ROLE();
    await validatorService.grantRole(VALIDATOR_MANAGER_ROLE, owner.address);

    await validatorService.registerValidator("Regular validator", "I love D2", 0, 0);
    const validatorId = 1;
    await validatorService.enableValidator(validatorId);

    await reentrancyTester.prepareToBurningAttack();
    const amount = ethers.parseEther("1");
    await skaleToken.mint(reentrancyTester, amount, "0x", "0x");
    await reentrancyTester.burningAttack()
      .should.be.eventually.rejectedWith("Token should be unlocked for transferring");
  });

  it("should parse call data correctly", async () => {
    const skaleTokenInternalTesterFactory = await ethers.getContractFactory("SkaleTokenInternalTester");
    const skaleTokenInternalTester = await skaleTokenInternalTesterFactory.deploy(contractManager, []);
    await skaleTokenInternalTester.getMsgData().should.be.eventually.equal(skaleTokenInternalTester.interface.encodeFunctionData("getMsgData"));
  });
});
