// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
    Ownership contract
    Modified https://eips.ethereum.org/EIPS/eip-173
    Added ownership transfer confirmation to prevent form giving ownership to wrong address
 */
contract Ownable {
    /// Current contract owner
    address public owner;
    /// New contract owner to be confirmed
    address public newOwner;
    /// Emit on every owner change
    event OwnershipChanged(address indexed from, address indexed to);

    /**
        Set default owner as contract deployer
     */
    constructor() {
        owner = msg.sender;
    }

    /**
        Use this modifier to limit function to contract owner
     */
    modifier onlyOwner() {
        require(msg.sender == owner, "Only for Owner");
        _;
    }

    /**
        Prepare to change ownersip. New owner need to confirm it.
        @param user address delegated to be new contract owner
     */
    function giveOwnership(address user) external onlyOwner {
        require(user != address(0x0), "renounceOwnership() instead");
        newOwner = user;
    }

    /**
        Accept contract ownership by new owner.
     */
    function acceptOwnership() external {
        require(
            newOwner != address(0x0) && msg.sender == newOwner,
            "Only newOwner can accept"
        );
        emit OwnershipChanged(owner, newOwner);
        owner = newOwner;
        newOwner = address(0x0);
    }

    /**
        Renounce ownership of the contract.
        Any function uses "onlyOwner" modifier will be inaccessible.
     */
    function renounceOwnership() external onlyOwner {
        emit OwnershipChanged(owner, address(0x0));
        owner = address(0x0);
    }
}
