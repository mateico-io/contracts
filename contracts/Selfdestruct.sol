// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

/**
    Only for testing ETH recovery
 */
contract SelfDestruct {
    /**
        Accept ETH send with deploy and send to target.
        Selfdestruct can send even if target is contract w/o payable function.
        It is not tripping payable nor fallback functions.
        @param target address to send ETH
     */
    constructor(address target) payable {
        selfdestruct(payable(target));
    }
}
