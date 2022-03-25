// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "./IERC20.sol";
import "./ERC20Internal.sol";

/**
    ERC20 burnable token implementation
 */
abstract contract ERC20 is IERC20, ERC20Internal {
    //
    // ERC20 data store
    //
    string internal _name;
    string internal _symbol;
    uint256 internal _supply;
    mapping(address => uint256) _balances;
    mapping(address => mapping(address => uint256)) _allowances;

    /**
        Token constructor
        @param name_ token name
        @param symbol_ token symbol
     */
    constructor(string memory name_, string memory symbol_) {
        _name = name_;
        _symbol = symbol_;
    }

    //
    // modifiers
    //
    modifier notZeroAddress(address user) {
        require(user != address(0x0), "Address 0x0 is prohibited");
        _;
    }

    //
    // readers
    //

    /// Token name
    function name() external view override returns (string memory) {
        return _name;
    }

    /// Token symbol
    function symbol() external view override returns (string memory) {
        return _symbol;
    }

    /// Token decimals
    function decimals() external pure override returns (uint8) {
        return 18;
    }

    /// Current total supply of token
    function totalSupply() external view override returns (uint256) {
        return _supply;
    }

    /// Balance of given user
    function balanceOf(address user) external view override returns (uint256) {
        return _balances[user];
    }

    /// Return current allowance
    function allowance(address user, address spender)
        external
        view
        returns (uint256)
    {
        return _allowances[user][spender];
    }

    //
    // external functions
    //

    /**
        Transfer tokens, emits event
        @param to destinantion address
        @param amount of tokens to send
        @return boolean true if succeed
     */
    function transfer(address to, uint256 amount)
        external
        override
        returns (bool)
    {
        _transfer(msg.sender, to, amount);
        return true;
    }

    /**
        Approve another address to spend (or burn) tokens
        @param spender authorized user address
        @param amount of tokens to be used
        @return boolean true if succeed
     */
    function approve(address spender, uint256 amount)
        external
        override
        returns (bool)
    {
        _approve(msg.sender, spender, amount);
        return true;
    }

    /**
        Transfer tokens by spending previous approval.
        "from" address need to set approval to transaction sender
        @param from source address
        @param to destination address
        @param amount of tokens to send
        @return boolean true if succeed
     */
    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external override returns (bool) {
        uint256 currentAllowance = _allowances[from][msg.sender];
        require(currentAllowance >= amount, "ERC20: allowance to low");
        if (currentAllowance < type(uint256).max) {
            unchecked {
                _allowances[from][msg.sender] = currentAllowance - amount;
            }
        }
        _transfer(from, to, amount);
        return true;
    }

    /**
        Destroy tokens form caller address
        @param amount of tokens to destory
        @return boolean true if succeed
     */
    function burn(uint256 amount) external returns (bool) {
        _burn(msg.sender, amount);
        return true;
    }

    /**
        Destroy tokens from earlier approved account
        @param user address of token owner to burn from
        @param amount of tokens to burn
        @return boolean true if succeed
     */
    function burnFrom(address user, uint256 amount) external returns (bool) {
        uint256 currentAllowance = _allowances[user][msg.sender];
        require(currentAllowance >= amount, "BurnFrom: allowance to low");
        unchecked {
            _allowances[user][msg.sender] = currentAllowance - amount;
        }
        _burn(user, amount);
        return true;
    }

    //
    // internal functions
    //

    /// Internal approve function, emits Approval event
    function _approve(
        address owner,
        address spender,
        uint256 amount
    ) internal override {
        _allowances[owner][spender] = amount;
        emit Approval(owner, spender, amount);
    }

    /// Internal transfer function, emits Transfer event
    function _transfer(
        address from,
        address to,
        uint256 amount
    ) internal override notZeroAddress(to) {
        uint256 balance = _balances[from];
        require(balance >= amount, "ERC20: balance to low");
        unchecked {
            _balances[from] = balance - amount;
            _balances[to] += amount;
        }
        emit Transfer(from, to, amount);
    }

    /// internal burn function, emits Transfer event
    function _burn(address from, uint256 amount) internal {
        uint256 currentBalance = _balances[from];
        require(currentBalance >= amount, "Burn: insufficient balance");
        unchecked {
            _balances[from] = currentBalance - amount;
            _supply -= amount;
        }
        emit Transfer(from, address(0x0), amount);
    }
}
