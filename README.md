# mateico.io contracts repository

## Token functionality

- token is fully ERC20 compliant
  - decimals are set to 18
- EIP712 domain
  - using contract `name`, `version`, `address` and `chainId`
- EIP2612 `permit` function
- EIP3009
  - `transferWithAuthorization`
  - `receiveWithAuthorization`
  - `cancelAuthorization`
- modified EIP173 - `ownership`
- `recovery` function for accidentally send ETH or ERC20 tokens to contract address

## Vesting functionality

Vesting contract allows to lock tokens inside for given time.

Every lock (vest) takes 4 parameters:

- start date - when claiming can be started
- end date - after which all locked tokens can be claimed
- start tokens - how much tokens can be claimed at start date
- total tokens - how much tokens in total are vested

One can have more than one vest configured.

Vesting contract imitate ERC20 token,
it can be added to wallet to track unclaimed balance of address.

User can also claim using wallet transfer function,
destination address and amount are ignored.

Vesting contract is ready for staking contract via claim2stake function.

## Deployment

Token constructor paramters are:

- token name
- token symbol
- contract version (normally `1`)
- total maximum number of tokens (remember about decimals!)

Contract deployer is contract Owner.

All tokens are sent to Owner address

Vesting constructor parameter is token contract address.

Owner need to approve vesting contract to make vestings,
as creating vesting is pulling tokens from owner walleet.

Owner can add new vestings at any time.

## Owner

After deploy Owner can use:

- `recoverEth` to get ETH from contract (if any force send)
- `recoverErc20` to get any ERC20 send to contract by accident/error
- `giveOwnership` to change Owner
  - new owner need confirm calling `acceptOwnership` function
- `renounceOwnership` to set Owner to 0x0 (can not be reverted!)

## Testing

Assuming `truffle` installed globally

If not, install with:

```sh
sudo npm -g install truffle
```

Install dependencies:

```sh
npm i
```

Compile and run tests:

```sh
truffle compile
npm test
```
