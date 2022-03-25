// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
    Internal functions from ERC20 token to be used for IEP2612 and IEP3009
 */
abstract contract ERC20Internal {
    // internal _approve call
    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal virtual;

    // internal _transfer call
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal virtual;
}
