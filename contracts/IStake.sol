// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
    Minimal interface for future Stake contract
    Functions needed by Vesting contract
 */
interface IStake {
    /// Vesting contract address
    function vestingAddress() external view returns (address);

    /// Function to call by vesting contract
    function claim2stake(address user, uint256 amount) external returns (bool);

    /// Event emited on successfull stake
    event Staked(address indexed user, uint256 amount);

        // Info of each user in pool
    struct UserInfo {
        uint256 endTime; // timestamp when tokens can be released
        uint256 totalAmount; // total reward to be withdrawn
    }

    // Info about staking pool
    struct PoolInfo {
        uint256 minStake; // minimum stake per user
        uint256 maxStake; // maximum stake per user
        uint256 startTime; // start of stake start window
        uint256 endTime; // end of stake start windows
        uint256 rewardPermill; // permill of reward (1permill of 1000 = 1, 20 will be 2%)
        uint256 lockPeriod; // required stake length
        uint256 maxTotalStaked; // maximum total tokens stoked on this
        uint256 totalStaked; // total tokens already staked
        bytes32 poolHash; // unique pool id needed to keep track of user deposits
    }

    /**
        Total user staked tokens and rewards
     */
    function totalStakedTokens() external view returns (uint256);

    /**
        Free reward tokens available for staking
     */
    function rewardsAvailable() external view returns (uint256);

    function addStakePool(
        uint256 minStake, // minimum stake per user
        uint256 maxStake, // maximum stake per user
        uint256 startTime, // start of stake start window
        uint256 endTime, // end of stake start windows
        uint256 rewardPermill, // permill of reward (1permill of 1000 = 1, 20 will be 2%)
        uint256 lockPeriod, // required stake length
        uint256 maxTotalStaked // maximum total tokens to be staked in pool
    ) external;

    /**
        Deposit tokens to given pool
     */
    function deposit(uint256 poolId, uint256 amount) external;

    event Deposit(
        address indexed user,
        uint256 indexed pid,
        uint256 amount,
        uint256 timeout
    );
    event Withdraw(address indexed user, uint256 amount);

}
