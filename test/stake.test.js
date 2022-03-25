const { accounts, contract } = require('@openzeppelin/test-environment');
const {
    constants,    // Common constants, like the zero address and largest integers
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
    time,
    balance
} = require('@openzeppelin/test-helpers');
const { BN } = require('bn.js');
const { toWei } = require('web3-utils');
const { expect } = require('chai');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');
const { MAX_UINT256 } = constants;

const Erc20 = contract.fromArtifact('Token');
const Stake = contract.fromArtifact('Stake')
const Vesting = contract.fromArtifact('Vesting')

describe('Staking', function () {
    const [owner, user1, user2] = accounts;
    const name = 'Mateico';
    const symbol = 'MATE';

    let token;
    let stake;
    let vesting;

    const initialBalance = new BN(toWei('1000000', 'ether'))

    const day = Number(time.duration.days(1))
    const week = Number(time.duration.days(7));

    const one = toWei('1', 'ether')
    const two = toWei('2', 'ether')
    const ten = toWei('10', 'ether')
    const hun = toWei('100', 'ether')
    const tho = toWei('1000', 'ether')

    beforeEach(async function () {
        token = await Erc20.new(name, symbol, "1", initialBalance, { from: owner });
        vesting = await Vesting.new(token.address);
        stake = await Stake.new(token.address, vesting.address, { from: owner })
    });

    it('stake points token', async function () {
        expect(await stake.tokenAddress()).to.eql(token.address)
    })

    /**
     * function addStakePool(
        uint256 minStake,
        uint256 maxStake,
        uint256 startTime,
        uint256 endTime,
        uint256 rewardPermill,
        uint256 lockPeriod,
        uint256 maxTotalStaked
    )
     */
    describe('Add stake checks', function () {
        it('throws on missing allowance', async function () {
            const timeNow = Number(await time.latest());

            await expectRevert(stake.addStakePool(
                one, two, timeNow + day, timeNow + week, 10, week, ten
                , { from: owner }), "ERC20: allowance to low")
        })
        it('pulls proper number of tokens', async function () {
            const timeNow = Number(await time.latest());
            await token.approve(stake.address, MAX_UINT256, { from: owner })
            await stake.addStakePool(
                one, two, timeNow + day, timeNow + week, 10, week, ten
                , { from: owner });
            expect(await token.balanceOf(stake.address)).to.be.bignumber.eq(toWei('0.1', 'ether'))
        })
        it('allows many stakes', async function () {
            const timeNow = Number(await time.latest());
            await token.approve(stake.address, MAX_UINT256, { from: owner })

            const minAmt = [one, one, one, two]
            const maxAmt = [ten, ten, ten, hun]
            const sd = [timeNow + day, timeNow + week, timeNow + day, timeNow + week]
            const ed = [timeNow + week + week, timeNow + week + day, timeNow + day + day, timeNow + week + day]
            const rpm = [10, 20, 1, 500]
            const period = [day, week, day, week]
            const maxTotal = [tho, tho, tho, tho]

            for (i = 0; i < 4; i++) {
                await stake.addStakePool(
                    minAmt[i], maxAmt[i], sd[i], ed[i], rpm[i], period[i], maxTotal[i]
                    , { from: owner });
            }
            expect(await stake.getPoolCount()).to.be.bignumber.eq('4')
            expect(await stake.rewardsAvailable()).to.be.bignumber.eq(toWei('531', 'ether'))
            expect(await stake.totalStakedTokens()).to.be.bignumber.eq('0')
            ret = await stake.poolInfo(3);
            expect(ret.rewardPermill).to.eq('500')
        })
    })
    describe('Deposit checks', function () {
        it('allow one deposit', async function () {
            var timeNow = Number(await time.latest());
            await token.approve(stake.address, MAX_UINT256, { from: owner })
            await stake.addStakePool(
                one, two, timeNow + day, timeNow + week, 10, week, ten
                , { from: owner });
            await token.transfer(user1, tho, { from: owner })
            await expectRevert(stake.deposit(0, one, { from: user1 })
                , "Pool not yet open")
            await time.increase(day + 1);
            await expectRevert(stake.deposit(0, one, { from: user1 })
                , "ERC20: allowance to low")
            await token.approve(stake.address, MAX_UINT256, { from: user1 })
            expect(await stake.rewardsAvailable()).to.be.bignumber.eq(toWei('0.1', 'ether')) // 1% of 10
            ret = await stake.deposit(0, one, { from: user1 })
            timeNow = Number(await time.latest());
            expectEvent(ret, "Deposit", {
                user: user1,
                pid: '0',
                amount: one,
                timeout: String(timeNow + week)
            })
            expect(await stake.getPoolCount()).to.be.bignumber.eq('1')
            expect(await stake.rewardsAvailable()).to.be.bignumber.eq(toWei('0.09', 'ether')) // 0.1 - 1%*1
            expect(await stake.totalStakedTokens()).to.be.bignumber.eq(toWei('1.01', 'ether'))
        })
        it('allows many deposits', async function () {
            var timeNow = Number(await time.latest());
            await token.approve(stake.address, MAX_UINT256, { from: owner })
            await stake.addStakePool(
                one, two, timeNow + day, timeNow + week, 10, week, ten
                , { from: owner });
            expect(await stake.rewardsAvailable()).to.be.bignumber.eq(toWei('0.1', 'ether')) // 1% of 10
            await token.transfer(user1, tho, { from: owner })
            await token.approve(stake.address, MAX_UINT256, { from: user1 })
            await time.increase(day + 1);
            await stake.deposit(0, one, { from: user1 })
            await time.increase(day);
            await stake.deposit(0, one, { from: user1 })
            expect(await stake.getUserStakeCount(user1)).to.be.bignumber.eq('2')
            ret = await stake.getUserStakes(user1);
            const diff = new BN(ret[1].endTime).sub(new BN(ret[0].endTime))
            expect(diff).to.be.bignumber.eq(String(day))
            expect(await stake.rewardsAvailable()).to.be.bignumber.eq(toWei('0.08', 'ether')) // 0.1 - 1%*2
            expect(await stake.totalStakedTokens()).to.be.bignumber.eq(toWei('2.02', 'ether'))
        })
        it('respects limits', async function () {
            var timeNow = Number(await time.latest());
            await token.approve(stake.address, MAX_UINT256, { from: owner })
            await stake.addStakePool(
                one, two, timeNow + day, timeNow + week, 10, week, toWei('3', 'ether')
                , { from: owner });
            await token.transfer(user1, tho, { from: owner })
            await token.transfer(user2, tho, { from: owner })
            await token.approve(stake.address, MAX_UINT256, { from: user1 })
            await token.approve(stake.address, MAX_UINT256, { from: user2 })
            await time.increase(day + 1);
            expect(await stake.rewardsAvailable()).to.be.bignumber.eq(toWei('0.03', 'ether')) // 1% of 3
            await expectRevert(stake.deposit(0, ten, { from: user1 }), "Pool is full")
            await expectRevert(stake.deposit(0, toWei('0.5', 'ether'), { from: user1 }), "Pool min stake per user")
            await stake.deposit(0, one, { from: user1 })
            await stake.deposit(0, one, { from: user1 })
            await expectRevert(stake.deposit(0, toWei('0.5', 'ether'), { from: user1 }), "Pool max stake per user")
            await stake.deposit(0, one, { from: user2 })
            await expectRevert(stake.deposit(0, one, { from: user2 }), "Pool is full")
            expect(await stake.rewardsAvailable()).to.be.bignumber.eq('0') // 0.03 - 1%*3
            expect(await stake.totalStakedTokens()).to.be.bignumber.eq(toWei('3.03', 'ether'))
        })
    })
    describe('Recovery test', function () {
        it('Respects user coins', async function () {
            const timeNow = Number(await time.latest());
            await token.approve(stake.address, MAX_UINT256, { from: owner })
            await stake.addStakePool(
                one, two, timeNow + day, timeNow + week, 10, week, toWei('3', 'ether')
                , { from: owner });
            await token.transfer(user1, tho, { from: owner })
            await token.approve(stake.address, MAX_UINT256, { from: user1 })
            await time.increase(day + 1);
            await stake.deposit(0, one, { from: user1 })
            const pre = await token.balanceOf(stake.address);
            await token.transfer(stake.address, two, { from: user1 })
            //take half
            await stake.recover(token.address, one, { from: owner })
            const post1 = await token.balanceOf(stake.address)
            expect(new BN(one).add(new BN(pre))).to.be.bignumber.eq(new BN(post1))
            //take all
            await stake.recover(token.address, '0', { from: owner })
            expect(await token.balanceOf(stake.address)).to.be.bignumber.eq(new BN(pre))
        })
        it('can recover rouge ETH', async function () {
            const killer = contract.fromArtifact('SelfDestruct');
            expect(await balance.current(stake.address)).to.be.bignumber.eq('0')
            await killer.new(stake.address, { value: one })
            expect(await balance.current(stake.address)).to.be.bignumber.eq(one)
            await stake.recover(ZERO_ADDRESS, 0, { from: owner })
            expect(await balance.current(stake.address)).to.be.bignumber.eq('0')
        })
    })

})
