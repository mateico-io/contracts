// SPDX-License-Identifier: MIT
pragma solidity ^0.8.10;

import "./IERC20.sol";
import "./IStake.sol";
import "./Ownable.sol";

contract Stake is IStake, Ownable {
    //
    // Storage
    //

    // Info of each pool.
    PoolInfo[] private _poolInfo;
    // [pool hash][user] = tokens in pool
    mapping(bytes32 => mapping(address => uint256)) private _userStake;

    // Info of each user that stakes.
    // [user]=UserInfo[]
    mapping(address => UserInfo[]) private _userInfo;

    address private immutable _tokenAddress;
    address private immutable _vestingAddress;

    uint256 private _stakedAndRewards;
    uint256 private _totalFreeRewards;

    string internal constant ERR_NS4U = "No stakes for user";
    string internal constant ERR_NOTHING = "Nothing to do";
    string internal constant ERR_NTR = "Nothing to recover";
    address internal ZERO_ADDRESS = address(0x0);

    /**
        Contract constructor
        @param token address of ERC20 token used
        @param vesting address of Vesting contract
     */
    constructor(address token, address vesting) {
        require(
            token != ZERO_ADDRESS && vesting != ZERO_ADDRESS,
            "Need both addresses"
        );
        _tokenAddress = token;
        _vestingAddress = vesting;
    }

    //
    // Readers
    //

    /// Address of ERC20 token used for staking
    function tokenAddress() external view returns (address) {
        return _tokenAddress;
    }

    /// Address of Vesting contract that can call claim2stake
    function vestingAddress() external view returns (address) {
        return _vestingAddress;
    }

    /**
        Return the length of pool array.
    */
    function getPoolCount() external view returns (uint256) {
        return _poolInfo.length;
    }

    /**
        Return single PoolInfo on given index
        @param poolId index of staking pool
        @return PoolInfo struct
     */
    function poolInfo(uint256 poolId) external view returns (PoolInfo memory) {
        return _poolInfo[poolId];
    }

    /**
        All available staking pools
        @return PoolInfo[] struct
     */
    function getPools() external view returns (PoolInfo[] memory) {
        return _poolInfo;
    }

    /// Total number of tokens staked by users
    function totalStakedTokens() external view returns (uint256) {
        return _stakedAndRewards;
    }

    /// Current number of tokens available as staking rewards
    function rewardsAvailable() external view returns (uint256) {
        return _totalFreeRewards;
    }

    /**
        Get array of all user stakes
        @param user address to check
        @return UserInfo[] array
     */
    function getUserStakes(address user)
        external
        view
        returns (UserInfo[] memory)
    {
        return _userInfo[user];
    }

    /**
        How many stakes given user created
        @param user adddress to check
        @return number of stakes
     */
    function getUserStakeCount(address user) external view returns (uint256) {
        return _userInfo[user].length;
    }

    /**
        Read UserInfo at given index
        @param user address to check
        @param index of stake for user
        @return UserInfo struct
     */
    function userInfo(address user, uint256 index)
        external
        view
        returns (UserInfo memory)
    {
        return _userInfo[user][index];
    }

    /**
        Return claimable tokens for given user at current time
        @param user address to check
        @return amount of tokens claimable now
     */
    function claimable(address user) external view returns (uint256 amount) {
        uint256 len = _userInfo[user].length;
        if (len > 0) {
            uint256 timeNow = block.timestamp;
            uint256 i;
            for (i; i < len; i++) {
                UserInfo memory u = _userInfo[user][i];
                if (timeNow > u.endTime) {
                    amount += u.totalAmount;
                }
            }
        }
    }

    /**
        Return total balance of user in contract
        @param user address to check
        @return amount of tokens staked + rewards
     */
    function stakedWithRewards(address user)
        external
        view
        returns (uint256 amount)
    {
        uint256 len = _userInfo[user].length;
        if (len > 0) {
            uint256 i;
            for (i; i < len; i++) {
                UserInfo memory u = _userInfo[user][i];
                amount += u.totalAmount;
            }
        }
    }

    //
    // Deposit and claim functions
    //

    /**
        Transfer ERC-20 token from sender's account to staking contract.
        Allowance need to be set first!
        @param poolId chosen staking pool
        @param amount of tokens to stake
    */
    function deposit(uint256 poolId, uint256 amount) external {
        if (uint256(c2sPoolHash) != 0) {
            require(poolId != c2sPool, "Pool only for Vesters");
        }
        _deposit(msg.sender, poolId, amount);
        // pull tokens
        require(
            IERC20(_tokenAddress).transferFrom(
                address(msg.sender),
                address(this),
                amount
            ),
            "" // this will throw in token if no allowance or balance
        );
    }

    function _deposit(
        address user,
        uint256 poolId,
        uint256 amount
    ) internal {
        require(poolId < _poolInfo.length, "Wrong pool index");

        // prevent infinite loop for users - limit one address to 10 staking positions
        // require(_userInfo[user].length < 10, "Too many stakes for user");

        // read storage
        PoolInfo memory pool = _poolInfo[poolId];
        uint256 newTotalAmt = _userStake[pool.poolHash][user] + amount;
        uint256 newTotalStaked = pool.totalStaked + amount;
        uint256 timeNow = block.timestamp;

        // check if selected Pool restrictions are met
        require(newTotalStaked <= pool.maxTotalStaked, "Pool is full");
        require(timeNow < pool.endTime, "Already closed");
        require(timeNow > pool.startTime, "Pool not yet open");
        require(newTotalAmt <= pool.maxStake, "Pool max stake per user");
        require(newTotalAmt >= pool.minStake, "Pool min stake per user");

        UserInfo memory newUI;

        newUI.endTime = timeNow + pool.lockPeriod;
        uint256 reward = (amount * pool.rewardPermill) / 1000;
        uint256 total = amount + reward;
        newUI.totalAmount = total;

        // update storage
        _userInfo[user].push(newUI);
        _poolInfo[poolId].totalStaked = newTotalStaked;
        _userStake[pool.poolHash][user] = newTotalAmt;
        _totalFreeRewards -= reward;
        _stakedAndRewards += total;

        // emit event
        emit Deposit(user, poolId, amount, newUI.endTime);
    }

    /**
        Returns full funded amount of ERC-20 token to requester if lock period is over.
        Looping and clearing all closed stakes for user.
    */
    function claim() external {
        // check if caller is a stakeholder
        uint256 len = _userInfo[msg.sender].length;
        require(len > 0, ERR_NS4U);

        uint256 totalWitdrawal;
        uint256 timeNow = block.timestamp;

        int256 i;
        for (i; i < int256(len); i++) {
            uint256 j = uint256(i);
            UserInfo memory u = _userInfo[msg.sender][j];
            if (timeNow > u.endTime) {
                totalWitdrawal += u.totalAmount;
                len--;
                _userInfo[msg.sender][j] = _userInfo[msg.sender][len];
                i--;
                _userInfo[msg.sender].pop();
            }
        }

        require(totalWitdrawal > 0, ERR_NOTHING);

        _stakedAndRewards -= totalWitdrawal;
        // emit proper event
        emit Withdraw(msg.sender, totalWitdrawal);
        // return funds
        require(
            IERC20(_tokenAddress).transfer(address(msg.sender), totalWitdrawal),
            "" //this will throw in token on error
        );
    }

    /**
        Claim only one stake slot.
        Can be useful in case global claim() fails out-of-gas.
        @param index of user stake to claim
     */
    function claimStake(uint256 index) external {
        // check if caller is a stakeholder
        uint256 len = _userInfo[msg.sender].length;
        require(len > 0, ERR_NS4U);

        uint256 totalWitdrawal;
        uint256 timeNow = block.timestamp;
        UserInfo memory u = _userInfo[msg.sender][index];
        if (timeNow > u.endTime) {
            totalWitdrawal = u.totalAmount;
            _userInfo[msg.sender][index] = _userInfo[msg.sender][len - 1];
            _userInfo[msg.sender].pop();
        }
        require(totalWitdrawal > 0, ERR_NOTHING);

        _stakedAndRewards -= totalWitdrawal;
        // emit proper event
        emit Withdraw(msg.sender, totalWitdrawal);
        // return funds
        require(
            IERC20(_tokenAddress).transfer(address(msg.sender), totalWitdrawal),
            "" //this will throw in token on error
        );
    }

    /// Index of staking pool designated for Vesters
    uint256 public c2sPool;
    // To avoid errors after pools reorganization
    bytes32 public c2sPoolHash;

    /**
        Check that c2s pool index match stored pool hash.
        Can be false after pools reorganization.
        @return true if configuration match data
     */
    function c2sConfigured() external view returns (bool) {
        return
            uint256(c2sPoolHash) != 0 &&
            _poolInfo[c2sPool].poolHash == c2sPoolHash;
    }

    /**
        Change stake pool index for claim2stake function
        @param idx new stake pool index
     */
    function updateC2Spool(uint256 idx) external onlyOwner {
        require(idx < _poolInfo.length, "Wrong poolId");
        c2sPool = idx;
        c2sPoolHash = _poolInfo[idx].poolHash;
    }

    /**
        Function to be call only form Vesting contract.
        One of stakes is designed to be "vesters only".
        @param user address of user
        @param amount of tokens to be staked
     */
    function claim2stake(address user, uint256 amount) external returns (bool) {
        require(msg.sender == _vestingAddress, "Only for Vesting contract");
        require(
            _poolInfo[c2sPool].poolHash == c2sPoolHash,
            "PoolHash not match"
        );
        _deposit(user, c2sPool, amount);
        // pull tokens from Vesting contract
        require(
            IERC20(_tokenAddress).transferFrom(
                address(_vestingAddress),
                address(this),
                amount
            ),
            "" // this will throw in token if no allowance or balance
        );
        return true;
    }

    //
    // Only owner functions
    //

    /**
        Open a new staking pool.
        Function is pulling tokens needed for rewards.
        Allowance need to be set earlier.
        @param minStake minimum tokens stake per user
        @param maxStake maximum stake per user
        @param startTime start of stake start window (unix timestamp)
        @param endTime  end of stake start window (unix timestamp)
        @param rewardPermill permill of reward (1permill of 1000 = 1, 20 will be 2%)
        @param lockPeriod required stake length in seconds
        @param maxTotalStaked maximum total tokens to be staked in this pool
    */
    function addStakePool(
        uint256 minStake,
        uint256 maxStake,
        uint256 startTime,
        uint256 endTime,
        uint256 rewardPermill,
        uint256 lockPeriod,
        uint256 maxTotalStaked
    ) external onlyOwner {
        require(minStake < maxStake && maxStake > 0, "min/max missconfigured");
        require(
            endTime > startTime && startTime > block.timestamp,
            "timestamps missconfigured"
        );
        require(lockPeriod > 0, "lock period zeroed");
        require(maxTotalStaked >= maxStake, "maxTotalStake too low");
        bytes32 poolHash = keccak256(
            abi.encodePacked(
                minStake,
                maxStake,
                startTime,
                endTime,
                rewardPermill,
                lockPeriod,
                maxTotalStaked
            )
        );
        _poolInfo.push(
            PoolInfo(
                minStake,
                maxStake,
                startTime,
                endTime,
                rewardPermill,
                lockPeriod,
                maxTotalStaked,
                0,
                poolHash
            )
        );

        uint256 totalRewards = (maxTotalStaked * rewardPermill) / 1000;
        _totalFreeRewards += totalRewards;

        // pull tokens for rewards
        require(
            IERC20(_tokenAddress).transferFrom(
                msg.sender,
                address(this),
                totalRewards
            ),
            "" // this will throw in token if no allowance or balance
        );
    }

    /**
        Reclaim not-reserved reward tokens, clean closed pools.
        Can cause misconfiguration in claim2stake functions.
     */
    function reclaimRewards() external onlyOwner {
        uint256 len = _poolInfo.length;
        require(len > 0, ERR_NOTHING);

        uint256 timeNow = block.timestamp;
        uint256 freeTokens;
        int256 i;
        for (i; i < int256(len); i++) {
            uint256 j = uint256(i);
            PoolInfo memory p = _poolInfo[j];
            if (p.endTime < timeNow) {
                freeTokens += (((p.maxTotalStaked - p.totalStaked) *
                    p.rewardPermill) / 1000);
                // clean storage
                len--;
                _poolInfo[j] = _poolInfo[len];
                _poolInfo.pop();
                i--;
            }
        }
        require(freeTokens > 0, ERR_NOTHING);

        _totalFreeRewards -= freeTokens;

        require(
            IERC20(_tokenAddress).transfer(owner, freeTokens),
            "" // will revert in token
        );
    }

    /**
        Recover native chain or any ERC20 token form contract.
        @param token address of token, 0x0 for native coin recovery
        @param amount of tokens/coins that want to recover, 0 for all
     */
    function recover(address token, uint256 amount) external onlyOwner {
        if (token == ZERO_ADDRESS) {
            uint256 balance = address(this).balance;
            require(balance > 0, ERR_NTR);
            if (amount > 0 && amount < balance) balance = amount;
            payable(owner).transfer(balance);
        } else {
            IERC20 t = IERC20(token);
            uint256 balance = t.balanceOf(address(this));
            require(balance > 0, ERR_NTR);
            if (token == _tokenAddress) {
                uint256 counted = _totalFreeRewards + _stakedAndRewards;
                require(balance > counted, ERR_NTR);
                balance -= counted;
            }
            if (amount > 0 && balance > amount) {
                balance = amount;
            }

            t.transfer(owner, balance);
        }
    }
}
