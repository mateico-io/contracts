// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./IERC20.sol";
import "./Ownable.sol";

/**
    ERC20 token and native coin recovery functions
 */
abstract contract Recoverable is Ownable {
    string internal constant ERR_NOTHING = "Nothing to recover";

    /// Recover native coin from contract
    function recoverETH() external onlyOwner {
        uint256 amt = address(this).balance;
        require(amt > 0, ERR_NOTHING);
        payable(owner).transfer(amt);
    }

    /// Recover ERC20 token from contract
    function recoverERC20(address token) external virtual onlyOwner {
        uint256 amt = IERC20(token).balanceOf(address(this));
        require(amt > 0, ERR_NOTHING);
        IERC20(token).transfer(owner, amt);
    }
}
