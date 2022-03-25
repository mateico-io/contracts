const { accounts, contract } = require('@openzeppelin/test-environment');

const {
    BN,           // Big Number support
    constants,
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
    time,   // for blockchain timestamp manipulations
} = require('@openzeppelin/test-helpers');

const { ZERO_ADDRESS, MAX_UINT256 } = constants;
const { toWei } = require('web3-utils');

const { expect } = require('chai');

const Erc20 = contract.fromArtifact('Token');
const Vesting = contract.fromArtifact("Vesting");

let day = Number(time.duration.days(1))
let week = Number(time.duration.days(7))

let one = toWei('1', 'ether');
let two = toWei('2', 'ether');
let ten = toWei('10', 'ether');
let sto = toWei('100', 'ether');
let tho = toWei('1000', 'ether');
let zero = new BN('0')

describe('Vesting contract test', function () {
    const [owner, user1, user2, user3, user4, user5] = accounts;

    const name = 'Mateico';
    const symbol = 'MATE';

    let token;
    let vesting;

    before(async function () {
        token = await Erc20.new(name, symbol, "1", tho, { from: owner });
        vesting = await Vesting.new(token.address, { from: owner })
    });

    describe('Deploy check', function () {
        it('points token', async function () {
            expect(await vesting.tokenAddress()).to.eql(token.address);

        })
        it('Has nothing vested', async function () {
            expect(await vesting.vested()).to.be.bignumber.eq(zero);
        })
        it('throws on wrong lock config', async function () {
            // function addLock(address user,uint256 startAmount,uint256 totalAmount,uint256 startDate,uint256 endDate)
            startTime = Number(await time.latest())
            // good one, but no no allowance
            await expectRevert(vesting.addLock(user1, one, two, startTime + day, startTime + week, { from: owner }), "ERC20: allowance to low")
            await token.approve(vesting.address, sto, { from: owner })
            // missconfigured in many ways
            await expectRevert(vesting.addLock(user1, one, two, startTime - 1, startTime + week, { from: owner }), "startDate below current time")
            await expectRevert(vesting.addLock(user1, one, two, startTime + day, startTime + week, { from: user1 }), "Only for Owner")
            await expectRevert(vesting.addLock(user1, 0, 0, startTime + day, startTime + week, { from: owner }), "Zero amount")
            await expectRevert(vesting.addLock(ZERO_ADDRESS, one, two, startTime + day, startTime + week, { from: owner }), "Zero address")
            await expectRevert(vesting.addLock(user1, one, two, startTime + week, startTime + day, { from: owner }), "Timestamps missconfigured")
        })

    })

    describe('Make vesting', function () {
        it('Add vesting properly', async function () {
            startTime = Number(await time.latest())

            // add lock by addLock()
            // fund locks 3 tokens for 10 days, 2 for 20, 1.5 for 100
            ret = await vesting.addLock(user1, one, toWei('3', 'ether'), String(startTime + 1), String(startTime + (day * 10)), { from: owner })
            expectEvent(ret, "VestingAdded", {
                user: user1,
                startAmount: one,
                totalAmount: toWei('3', 'ether'),
                startDate: String(startTime + 1),
                endDate: String(startTime + (day * 10))
            })
            await vesting.addLock(user1, 0, toWei('2', 'ether'), String(startTime + (day * 10)), String(startTime + (day * 30)), { from: owner })
            await vesting.addLock(user1, 0, toWei('1.5', 'ether'), String(startTime + (day * 30)), String(startTime + (day * 130)), { from: owner })
            // there should be 3 vestings
            expect(await vesting.getVestingsCount(user1)).to.be.bignumber.eq('3')
            // check last lock
            ret = await vesting.getVesting(user1, 2)
            //console.log(ret)
            expect(String(ret.startAmount)).to.eql('0')
            expect(String(ret.totalAmount)).to.eql(toWei('1.5', 'ether'))
            expect(String(ret.startDate)).to.eql(String(startTime + (day * 30)))
            expect(String(ret.endDate)).to.eql(String(startTime + (day * 130)))
            expect(String(ret.claimed)).to.eql("0")

            // add more vests for rest of the tests
            // user2 vests: 1 for 10 days, 0.8 for 20, 0.5 for 100
            // user3 vests: 0.5 for 20 days, 0.5 for 40, 0.5 for 80
            la = [user2, user2, user2, user3, user3, user3, user5]
            sa = [0, 0, 0, 0, 0, 0, 0]
            ta = [toWei('1', 'ether'), toWei('0.8', 'ether'), toWei('0.5', 'ether')
                , toWei('0.5', 'ether'), toWei('0.5', 'ether'), toWei('0.5', 'ether'), toWei('1', 'ether')]
            sd = [String(startTime + day), String(startTime + (day * 10)), String(startTime + (day * 30))
                , String(startTime + day), String(startTime + (day * 20)), String(startTime + (day * 60)), String(startTime + (day * 60))]
            ed = [String(startTime + (day * 10)), String(startTime + (day * 30)), String(startTime + (day * 130))
                , String(startTime + (day * 20)), String(startTime + (day * 60)), String(startTime + (day * 140)), String(startTime + (day * 140))]
            for (let i = 0; i < 7; i++) {
                await vesting.addLock(la[i], sa[i], ta[i], sd[i], ed[i], { from: owner })
            }
        })

        it('Fail on not enough tokens', async function () {
            await token.approve(vesting.address, MAX_UINT256, { from: owner })
            await expectRevert(vesting.addLock(user1, 0, tho, String(startTime + (day * 30)), String(startTime + (day * 130)), { from: owner })
                , "ERC20: balance to low");
        })
    })

    describe('Claim vested tokens', function () {
        it('Throws when no vests', async function () {
            await expectRevert(vesting.claim({ from: user4 }), "No locks for user")
        })
        it('Fails if too early', async function () {
            await expectRevert(vesting.claim({ from: user1 }), "Nothing to claim")
        })
        it('Calims in the middle properly', async function () {
            await time.increaseTo(startTime + (day * 5))
            ret = await vesting.claim({ from: user3 })
            expectEvent(ret, "Claimed", {
                user: user3,
                amount: '105263157894736842' // approx 0.5*4/19
            })
        })
        it('Fails when nothing more to claim', async function () {
            await expectRevert(vesting.claim({ from: user3 }), "Nothing to claim")
        })
        it('claims properly on lock change', async function () {
            await time.increaseTo(startTime + (day * 20))
            ret = await vesting.claim({ from: user2 })
            expectEvent(ret, "Claimed", {
                user: user2,
                amount: toWei('1.4', 'ether') //1+0.8/2
            })
        })
        it('claims everyting at end', async function () {
            await time.increaseTo(startTime + (day * 140) + 10)
            ret = await vesting.claim({ from: user1 })
            expectEvent(ret, "Claimed", {
                user: user1,
                amount: toWei('6.5', 'ether')
            })
            ret = await vesting.claim({ from: user2 })
            expectEvent(ret, "Claimed", {
                user: user2,
                amount: toWei('0.9', 'ether')
            })
            ret = await vesting.claim({ from: user3 })
            expectEvent(ret, "Claimed", {
                user: user3,
                amount: '1394736842105263158' // up to 1.5
            })
            ret = await vesting.claim({ from: user5 })
            expectEvent(ret, "Claimed", {
                user: user5,
                amount: toWei('1', 'ether')
            })
        })

    })
    describe("ERC20 imitation test", function () {
        it('looks like erc20 token', async function () {
            expect(await vesting.name()).to.eql('vested Mateico')
            expect(await vesting.symbol()).to.eql('vMATE')
            expect(await vesting.decimals()).to.be.bignumber.eq('18')
        })
        it('shows balance', async function () {
            // add some vesting
            startTime = Number(await time.latest())
            await vesting.addLock(user1, zero, ten, startTime + day, startTime + week, { from: owner });
            expect(await vesting.balanceOf(user1)).to.be.bignumber.eq(ten)
        })
        it('claim by transfer call', async function () {
            // advance and call
            // advance blockchain
            await time.increaseTo(startTime + (day * 4))
            // tranfer(address, uint)
            let ret = await vesting.transfer(user2, one, { from: user1 })
            expectEvent(ret, "Claimed", {
                user: user1,
                amount: toWei('5', 'ether') // 3/6 days from 10 tokens
            })
            expect(await vesting.balanceOf(user1)).to.be.bignumber.eq(toWei('5', 'ether'))
        })
    })

});
