/*
    DelegationRequestManager.sol - SKALE Manager
    Copyright (C) 2018-Present SKALE Labs
    @author Vadim Yavorsky
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

pragma solidity ^0.5.3;
pragma experimental ABIEncoderV2;

import "../Permissions.sol";
import "./DelegationPeriodManager.sol";
import "./ValidatorService.sol";
import "../interfaces/delegation/IDelegatableToken.sol";
import "../thirdparty/BokkyPooBahsDateTimeLibrary.sol";
import "./ValidatorService.sol";
import "./DelegationController.sol";
import "../SkaleToken.sol";
import "./TokenState.sol";


contract DelegationRequestManager is Permissions {

    struct DelegationRequest {
        address holder;
        uint validatorId;
        uint amount;
        uint delegationPeriod;
        uint unlockedUntill;
        string description;
    }

    DelegationRequest[] public delegationRequests;

    constructor(address newContractsAddress) Permissions(newContractsAddress) public {

    }

    function createRequest(
        address holder,
        uint validatorId,
        uint amount,
        uint delegationPeriod,
        string calldata info
    )
        external
        returns (uint delegationId)
    {
        ValidatorService validatorService = ValidatorService(
            contractManager.getContract("ValidatorService")
        );
        DelegationPeriodManager delegationPeriodManager = DelegationPeriodManager(
            contractManager.getContract("DelegationPeriodManager")
        );
        TokenState tokenState = TokenState(
            contractManager.getContract("TokenState")
        );
        DelegationController delegationController = DelegationController(
            contractManager.getContract("DelegationController")
        );
        require(
            delegationPeriodManager.isDelegationPeriodAllowed(delegationPeriod),
            "This delegation period is not allowed"
        );
        require(validatorService.checkValidatorExists(validatorId), "Validator is not registered");
        delegationId = delegationController.addDelegation(
            holder,
            validatorId,
            amount,
            now,
            delegationPeriod,
            info
        );

        tokenState.setState(delegationId, TokenState.State.PROPOSED);
        uint holderBalance = SkaleToken(contractManager.getContract("SkaleToken")).balanceOf(holder);
        uint lockedTokens = tokenState.getLockedCount(holder);
        require(holderBalance - lockedTokens >= amount, "Not enough tokens to delegate");
    }

    function cancelRequest(uint delegationId) external {
        TokenState tokenState = TokenState(
            contractManager.getContract("TokenState")
        );
        DelegationController delegationController = DelegationController(
            contractManager.getContract("DelegationController")
        );
        DelegationController.Delegation memory delegation = delegationController.getDelegation(delegationId);
        require(msg.sender == delegation.holder,"No permissions to cancel request");
        require(
            tokenState.cancel(delegationId, delegation) == TokenState.State.COMPLETED,
            "After cancellation token should be COMPLETED");
    }

    function acceptRequest(uint delegationId) external {
        TokenState tokenState = TokenState(
            contractManager.getContract("TokenState")
        );
        DelegationController delegationController = DelegationController(
            contractManager.getContract("DelegationController")
        );
        ValidatorService validatorService = ValidatorService(
            contractManager.getContract("ValidatorService")
        );
        DelegationController.Delegation memory delegation = delegationController.getDelegation(delegationId);
        require(
            validatorService.checkValidatorIdToAddress(delegation.validatorId, msg.sender),
            "No permissions to accept request"
        );
        delegationController.delegate(delegationId);
        tokenState.setState(delegationId, TokenState.State.ACCEPTED);
    }

}