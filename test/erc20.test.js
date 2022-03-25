const { accounts, contract } = require('@openzeppelin/test-environment');

const {
    BN,           // Big Number support
    constants,    // Common constants, like the zero address and largest integers
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
} = require('@openzeppelin/test-helpers');

const { ZERO_ADDRESS } = constants;

const { expect } = require('chai');

const Erc20 = contract.fromArtifact('Token');

describe('ERC20-test', function () {
    const [owner, user1, user2, user3] = accounts;

    const name = 'Mateico';
    const symbol = 'MATE';

    const tentho = new BN(10000);
    const sto = new BN(100);
    const ten = new BN(10);
    const one = new BN(1)

    let token;

    before(async function () {
        token = await Erc20.new(name, symbol, "1", tentho, { from: owner });
    });

    it('has a name', async function () {
        expect(await token.name()).to.equal(name);
    });

    it('has a symbol', async function () {
        expect(await token.symbol()).to.equal(symbol);
    });

    it('has 18 decimals', async function () {
        expect(await token.decimals()).to.be.bignumber.equal(new BN(18));
    });

    it('has initial balance', async function () {
        expect(await token.totalSupply()).to.be.bignumber.equal(tentho);
    });

    describe('Transfer', function () {
        it('can transfer', async function () {
            ret = await token.transfer(user1, sto, { from: owner });
            expectEvent(ret, 'Transfer', {
                from: owner,
                to: user1,
                value: sto
            })
        })
        it('Throws when no balance', async function () {
            await expectRevert(token.transfer(user1, tentho, { from: user1 }),
                "ERC20: balance to low")
        })
    })

    describe('Approve/allowance', function () {
        it('Set allowance', async function () {
            expectEvent(await token.approve(user2, ten, { from: user1 }),
                'Approval', {
                owner: user1,
                spender: user2,
                value: ten,
            })
        })
        it('Use TrasferFrom', async function () {
            ret = await token.transferFrom(user1, user3, one, { from: user2 });
            expectEvent(ret,
                'Transfer', {
                from: user1,
                to: user3,
                value: one,
            })
        })
        it('Throw when exceed allowance', async function () {
            await expectRevert(token.transferFrom(user1, user3, sto, { from: user2 }),
                "ERC20: allowance to low")
        })
    })

});
