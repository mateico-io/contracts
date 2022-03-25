// SPDX-License-Identifier: MIT

pragma solidity ^0.8.10;

import "./Ownable.sol";
import "./IERC20.sol";
import "./IStake.sol";
import "./Recovery.sol";

/**
    Vesting contract for mateico.io projct
 */
contract Vesting is Ownable, Recoverable {
    /// address of mateico.io token
    address public immutable tokenAddress;

    /// amount of vested tokens
    uint256 public vested;

    // Vest struct
    struct Vest {
        uint256 startAmount; // tokens that can be claimed at start date
        uint256 totalAmount; // total tokens to be released
        uint256 startDate; // date from which startAmount can be taken
        uint256 endDate; // date to which all totalAmount will be released
        uint256 claimed; // tokens already claimed from this vesting
    }

    // vesting list per user, can be multiple per user
    mapping(address => Vest[]) private _vestings;

    /// Event on creating vesting
    event VestingAdded(
        address indexed user,
        uint256 startAmount,
        uint256 totalAmount,
        uint256 startDate,
        uint256 endDate
    );

    /// event on caliming coins from vesting
    event Claimed(address indexed user, uint256 amount);

    //
    // constructor
    //
    /**
        Contract constructor
        @param token address to be used in contract
     */
    constructor(address token) {
        tokenAddress = token;
    }

    /**
        Create vesting for user.
        Owner need to approve contract earlier and have tokens on address.
        @param user address of user that can claim from lock
        @param totalAmount total number of coins to be released
        @param startDate timestamp when user can start caliming and get startAmount
        @param endDate timestamp after which totalAmount can be claimed
     */
    function addLock(
        address user,
        uint256 startAmount,
        uint256 totalAmount,
        uint256 startDate,
        uint256 endDate
    ) external onlyOwner {
        require(
            IERC20(tokenAddress).transferFrom(
                msg.sender,
                address(this),
                totalAmount
            ),
            "Token transfer failed!" // this will revert in token
        );
        require(user != address(0x0), "Zero address");
        require(totalAmount > 0, "Zero amount");
        require(endDate > startDate, "Timestamps missconfigured");
        require(startDate > block.timestamp, "startDate below current time");
        Vest memory c = Vest(startAmount, totalAmount, startDate, endDate, 0);
        _vestings[user].push(c);
        vested += totalAmount;
        emit VestingAdded(user, startAmount, totalAmount, startDate, endDate);
    }

    /**
        Check how much tokens can be claimed at given moment
        @param user address to calculate
        @return sum number of tokens to claim (with 18 decimals)
    */
    function claimable(address user) external view returns (uint256 sum) {
        uint256 len = _vestings[user].length;
        if (len > 0) {
            uint256 i;
            for (i; i < len; i++) {
                sum += _claimable(_vestings[user][i]);
            }
        }
    }

    /**
        Count number of tokens claimable form given vesting
        @param c Vesting struct data
        @return amt number of tokens possible to claim
     */
    function _claimable(Vest memory c) internal view returns (uint256 amt) {
        uint256 time = block.timestamp;
        if (time > c.startDate) {
            if (time > c.endDate) {
                // all coins can be released
                amt = c.totalAmount;
            } else {
                // we need calculate how much can be released
                uint256 pct = ((time - c.startDate) * 1 ether) /
                    (c.endDate - c.startDate);
                amt =
                    c.startAmount +
                    ((c.totalAmount - c.startAmount) * pct) /
                    1 ether;
            }
            amt -= c.claimed; // some may be already claimed
        }
    }

    /**
       Claim all possible tokens
    */
    function claim() external {
        uint256 sum = _claim(msg.sender);
        require(
            IERC20(tokenAddress).transfer(msg.sender, sum),
            "" // will fail in token on transfer error
        );
    }

    /**
        Internal claim function
        @param user address to calculate
        @return sum number of tokens claimed
     */
    function _claim(address user) internal returns (uint256 sum) {
        uint256 len = _vestings[user].length;
        require(len > 0, "No locks for user");

        uint256 i;
        for (i; i < len; i++) {
            Vest storage c = _vestings[user][i];
            uint256 amt = _claimable(c);
            c.claimed += amt;
            sum += amt;
        }

        require(sum > 0, "Nothing to claim");
        vested -= sum;
        emit Claimed(user, sum);
    }

    /**
        All vestings of given address in one call
        @param user address to check
        @return tuple of all locks
     */
    function vestingsOfUser(address user) public view returns (Vest[] memory) {
        return _vestings[user];
    }

    /**
        Check number of vestings for given user
        @param user address to check
        @return number of vestings for user
     */
    function getVestingsCount(address user) external view returns (uint256) {
        return _vestings[user].length;
    }

    /**
        Return single vesting info
        @param user address to check
        @param index of vesting to show
     */
    function getVesting(address user, uint256 index)
        external
        view
        returns (Vest memory)
    {
        require(index < _vestings[user].length, "Index out of range");
        return _vestings[user][index];
    }

    //
    // Stake/Claim2stake
    //
    /// Address of stake contract
    address public stakeAddress;

    /**
        Set address of stake contract (once, only owner)
        @param stake contract address
     */
    function setStakeAddress(address stake) external onlyOwner {
        require(stakeAddress == address(0x0), "Contract already set");
        stakeAddress = stake;
        require(
            IStake(stakeAddress).vestingAddress() == address(this),
            "Wrong contract address"
        );
        require(
            IERC20(tokenAddress).approve(stakeAddress, type(uint256).max),
            "Token approval failed"
        );
    }

    /**
        Claim possible tokens and stake directly to contract
     */
    function claim2stake() external {
        require(stakeAddress != address(0x0), "Stake contract not set");
        uint256 sum = _claim(msg.sender);
        require(
            IStake(stakeAddress).claim2stake(msg.sender, sum),
            "Claim2stake call failed"
        );
    }

    //
    // Token recovery override, disallow vested tokens withdrawal
    //
    function recoverERC20(address token) external override onlyOwner {
        uint256 amt = IERC20(token).balanceOf(address(this));

        if (token == tokenAddress) {
            amt -= vested;
        }
        require(amt > 0, ERR_NOTHING);
        IERC20(token).transfer(owner, amt);
    }

    //
    // Imitate ERC20 token, show unclaimed tokens
    //

    string public constant name = "vested Mateico";
    string public constant symbol = "vMATE";
    uint8 public constant decimals = 18;

    /**
        Read total unclaimed balance for given user
        @param user address to check
        @return amount of unclaimed tokens locked in contract
     */
    function balanceOf(address user) external view returns (uint256 amount) {
        uint256 len = _vestings[user].length;
        if (len > 0) {
            uint256 i;
            for (i; i < len; i++) {
                Vest memory v = _vestings[user][i];
                amount += (v.totalAmount - v.claimed);
            }
        }
    }

    /**
        Imitation of ERC20 transfer() function to claim from wallet.
        Ignoring parameters, returns true if claim succeed.
     */
    function transfer(address, uint256) external returns (bool) {
        uint256 sum = _claim(msg.sender);
        require(
            IERC20(tokenAddress).transfer(msg.sender, sum),
            "" // will throw in token contract on transfer fail
        );
        return true;
    }
}
