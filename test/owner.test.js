const { accounts, contract } = require('@openzeppelin/test-environment');

const {
    BN,           // Big Number support
    constants,    // Common constants, like the zero address and largest integers
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
    balance // for ETH balance checking
} = require('@openzeppelin/test-helpers');

const { ZERO_ADDRESS } = constants;

const { expect } = require('chai');

const Erc20 = contract.fromArtifact('Token');
const SelfDestruct = contract.fromArtifact('SelfDestruct');

describe('Ownership test', function () {
    const [owner, user1, user2, user3] = accounts;

    const name = 'Mateico';
    const symbol = 'MATE';

    const tentho = new BN(10000);
    const oneEth = 1e18
    const sto = new BN(100);

    let token;
    let rouge; //rouge token for testing
    let killer; // rouge ETH source

    before(async function () {
        token = await Erc20.new(name, symbol, "1", tentho, { from: owner });
        rouge = await Erc20.new(name, symbol, "1", tentho, { from: user1 });
        killer = await SelfDestruct.new(token.address, { value: oneEth })
    });

    describe('recovery', function () {
        it('can recover ERC20', async function () {
            await rouge.transfer(token.address, sto, { from: user1 })
            expect(await rouge.balanceOf(token.address)).to.be.bignumber.eq(sto)
            await token.recoverERC20(rouge.address, { from: owner })
            expect(await rouge.balanceOf(token.address)).to.be.bignumber.eq('0')
            await expectRevert(token.recoverERC20(rouge.address, { from: owner }),
                "Nothing to recover")
            await expectRevert(token.recoverERC20(rouge.address, { from: user1 }),
                "Only for Owner")
        })
        it('can recover ETH', async function () {
            expect(await balance.current(token.address)).to.be.bignumber.eq(String(oneEth))
            await token.recoverETH({ from: owner })
            expect(await balance.current(token.address)).to.be.bignumber.eq('0')
            await expectRevert(token.recoverETH({ from: owner }),
                "Nothing to recover")
            await expectRevert(token.recoverETH({ from: user1 }),
                "Only for Owner")
        })
    })

    describe('Ownership change', function () {
        it('change owner', async function () {
            await token.giveOwnership(user3, { from: owner })
            expect(await token.newOwner()).to.eql(user3)
            await expectRevert(token.giveOwnership(user3, { from: user2 }),
                "Only for Owner")
            await expectRevert(token.acceptOwnership({ from: user1 }),
                "Only newOwner");
            let ret = await token.acceptOwnership({ from: user3 })
            expectEvent(ret, "OwnershipChanged", {
                from: owner,
                to: user3
            })
            expect(await token.owner()).to.eq(user3)
            expect(await token.newOwner()).to.eq(ZERO_ADDRESS)
        })
        it('Ownership renounce', async function () {
            let ret = await token.renounceOwnership({ from: user3 })
            expectEvent(ret, "OwnershipChanged", {
                from: user3,
                to: ZERO_ADDRESS
            })
            expect(await token.owner()).to.eq(ZERO_ADDRESS)
        })
    })
})
