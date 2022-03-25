// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./IERC20.sol";

/**
    Mock future staking contract
 */
contract StakeMock {
    /// ERC20 token address
    address public immutable tokenAddress;
    /// Total tokens staked
    uint256 public staked;
    /// Vesting contract address
    address public immutable vestingAddress;

    /**
        Contract constructor
        @param _token contract address
        @param _vesting contract address
     */
    constructor(address _token, address _vesting) {
        tokenAddress = _token;
        vestingAddress = _vesting;
    }

    /// Event emited on successfull stake
    event Staked(address indexed user, uint256 amount);

    /**
        Accept tokens send by claim2stake function in vesting contract
        @param user address of claimer
        @param amount of tokens to stake
        @return boolean true if succeed
     */
    function claim2stake(address user, uint256 amount) external returns (bool) {
        require(msg.sender == vestingAddress, "Only for vesting contract");
        require(
            IERC20(tokenAddress).transferFrom(
                vestingAddress,
                address(this),
                amount
            ),
            "Claim2stake: Token transfer failed"
        );
        staked += amount;
        emit Staked(user, amount);
        return true;
    }
}
