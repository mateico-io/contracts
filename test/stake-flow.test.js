const { accounts, contract } = require('@openzeppelin/test-environment');
const {
    constants,    // Common constants, like the zero address and largest integers
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
    time
} = require('@openzeppelin/test-helpers');
const { BN } = require('bn.js');
const { toWei } = require('web3-utils');
const { expect } = require('chai');
const { MAX_UINT256 } = constants;

const Erc20 = contract.fromArtifact('Token');
const Stake = contract.fromArtifact('Stake')
const Vesting = contract.fromArtifact('Vesting')

describe('Staking flow', function () {
    const [owner, user1, user2, user3] = accounts;
    const name = 'Mateico';
    const symbol = 'MATE';

    const day = Number(time.duration.days(1))
    const week = Number(time.duration.days(7));

    const one = toWei('1', 'ether')
    const two = toWei('2', 'ether')
    const ten = toWei('10', 'ether')
    const hun = toWei('100', 'ether')
    const tho = toWei('1000', 'ether')

    let token;
    let vesting;
    let stake;
    const initialBalance = new BN(toWei('1000000', 'ether'))
    let timeStart;

    before(async function () {
        token = await Erc20.new(name, symbol, "1", initialBalance, { from: owner });
        vesting = await Vesting.new(token.address);
        stake = await Stake.new(token.address, vesting.address, { from: owner })

        timeStart = Number(await time.latest());
        await token.approve(stake.address, MAX_UINT256, { from: owner })
    });

    describe('Create stakes', function () {
        it('Add stake pools', async function () {
            const minAmt = [one, one, one, two]
            const maxAmt = [ten, ten, ten, hun]
            const sd = [timeStart + day, timeStart + week, timeStart + day, timeStart + week]
            const ed = [timeStart + week + week, timeStart + week + day, timeStart + day + day, timeStart + week + day]
            const rpm = [10, 20, 1, 500]
            const period = [week + day + day, week, day, week + week]
            const maxTotal = [tho, tho, tho, tho]

            for (i = 0; i < 4; i++) {
                await stake.addStakePool(
                    minAmt[i], maxAmt[i], sd[i], ed[i], rpm[i], period[i], maxTotal[i]
                    , { from: owner });
            }

        })
        it('Verify pools', async function () {
            // just to check it is added, full checks in stake.test.js
            ret = await stake.getPools();
            expect(ret.length).eq(4)
            expect(ret[2].rewardPermill).to.be.bignumber.eq('1')
            expect(await stake.rewardsAvailable()).to.be.bignumber.eq(toWei('531', 'ether'))
        })
    })
    describe('Deposits', function () {
        it('allow deposits from different users to different open pools', async function () {
            await token.transfer(user1, tho, { from: owner })
            await token.transfer(user2, tho, { from: owner })
            await token.transfer(user3, tho, { from: owner })
            await token.approve(stake.address, MAX_UINT256, { from: user1 })
            await token.approve(stake.address, MAX_UINT256, { from: user2 })
            await token.approve(stake.address, MAX_UINT256, { from: user3 })

            await time.increaseTo(timeStart + day + 1) // open pools 0 and 2

            await stake.deposit(0, ten, { from: user1 }) // ends at start + week + 3 days
            await stake.deposit(2, ten, { from: user1 }) // ends at strat + 2 days
            await stake.deposit(0, two, { from: user2 })
            await stake.deposit(2, ten, { from: user3 })
            await stake.deposit(2, two, { from: user2 })
            await time.increaseTo(timeStart + week + 1) // open pools 1,3, closed 2
            await expectRevert(stake.deposit(2, two, { from: user1 }), "Already closed")
            await stake.deposit(1, two, { from: user2 }) // ends at start + 2 weeks
            await stake.deposit(3, ten, { from: user2 }) // ends at start + 3 weeks
            await stake.deposit(1, two, { from: user3 })
            await stake.deposit(3, ten, { from: user3 })
            await stake.deposit(3, two, { from: user3 })
        })
    })
    describe('Readers', function () {
        it('reads pool data', async function () {
            let ret = await stake.getPools()
            expect(ret.length).to.eq(4) // 4 pools
            // staked in each pool
            expect(ret[0].totalStaked).to.be.bignumber.eq(toWei('12', 'ether'))
            expect(ret[1].totalStaked).to.be.bignumber.eq(toWei('4', 'ether'))
            expect(ret[2].totalStaked).to.be.bignumber.eq(toWei('22', 'ether'))
            expect(ret[3].totalStaked).to.be.bignumber.eq(toWei('22', 'ether'))
            ret = await stake.rewardsAvailable();
            //531 - (12*1% + 4*2% + 22*0.1% + 22*50%) = 519,778
            // 0.12 + 0,08 + 0,022 + 11 = 11,222
            expect(ret).to.be.bignumber.eq(toWei('519.778', 'ether'))
        })
        it('reads user data', async function () {
            const ret1 = await stake.getUserStakes(user1)
            const ret2 = await stake.getUserStakes(user2)
            const ret3 = await stake.getUserStakes(user3)
            const st1 = await stake.stakedWithRewards(user1)
            const st2 = await stake.stakedWithRewards(user2)
            const st3 = await stake.stakedWithRewards(user3)
            expect(ret1.length).to.eq(2)
            expect(ret2.length).to.eq(4)
            expect(ret3.length).to.eq(4)
            expect(new BN(ret1[0].totalAmount).add(new BN(ret1[1].totalAmount))).to.be.bignumber.eq(st1)
            expect(new BN(ret2[0].totalAmount).add(new BN(ret2[1].totalAmount)).add(new BN(ret2[2].totalAmount)).add(new BN(ret2[3].totalAmount))).to.be.bignumber.eq(st2)
            expect(new BN(ret3[0].totalAmount).add(new BN(ret3[1].totalAmount)).add(new BN(ret3[2].totalAmount)).add(new BN(ret3[3].totalAmount))).to.be.bignumber.eq(st3)
        })
    })
    describe('Claiming', function () {
        it('Owner can reclaim unused reward tokens', async function () {
            // pool 2 is closed, 
            // 0.1% reward from 1000 coins total = 1 reward, 
            // staked 22 coins, so 0.978 "free reward" left
            const pre = await token.balanceOf(owner)
            await stake.reclaimRewards({ from: owner })
            const post = await token.balanceOf(owner)
            expect(new BN(post).sub(new BN(pre))).to.be.bignumber.eq(toWei('0.978', 'ether'))

            // pool 2 is removed, should be 0,1,3
            const len = await stake.getPools()
            expect(len.length).to.eq(3)
            ret = await stake.poolInfo(2)
            expect(ret.lockPeriod).to.be.bignumber.eq(new BN(week + week))
            // 519.778 - 0.978
            ret = await stake.rewardsAvailable();
            expect(ret).to.be.bignumber.eq(toWei('518.8', 'ether'))
        })
        it('claimStake from one pool', async function () {
            // user index 0 is stake from pool index 2 that can be claimed
            // for 10 + 1%
            const cl1 = await stake.claimStake(0, { from: user3 })
            expectEvent(cl1, "Withdraw", {
                user: user3,
                amount: toWei('10.01', 'ether')
            })

        })
        it('claims from many pools', async function () {
            let cl1 = await stake.claimable(user1) //10 *1.001
            let cl2 = await stake.claimable(user2) //2 *1.001
            let cl3 = await stake.claimable(user3) //0, claimed in claimOne
            // at this point of time only pool 2 period passed (also cleaned)
            expect(cl1).to.be.bignumber.eq(toWei('10.01', 'ether'))
            expect(cl2).to.be.bignumber.eq(toWei('2.002', 'ether'))
            expect(cl3).to.be.bignumber.eq(toWei('0', 'ether'))
            //advance week more to end periods of staking pools 0 and 1
            await time.increaseTo(timeStart + week + week + day)
            cl1 = await stake.claimable(user1) //10 *1.001 + 10+1%
            cl2 = await stake.claimable(user2) //2 *1.001 + 2+2% + 2+1%
            cl3 = await stake.claimable(user3) //2+2%
            expect(cl1).to.be.bignumber.eq(toWei('20.11', 'ether'))
            expect(cl2).to.be.bignumber.eq(toWei('6.062', 'ether'))
            expect(cl3).to.be.bignumber.eq(toWei('2.04', 'ether'))
            const pre1 = await token.balanceOf(user1)
            const pre2 = await token.balanceOf(user2)
            const pre3 = await token.balanceOf(user3)
            await stake.claim({ from: user1 })
            await stake.claim({ from: user2 })
            await stake.claim({ from: user3 })
            const post1 = await token.balanceOf(user1)
            const post2 = await token.balanceOf(user2)
            const post3 = await token.balanceOf(user3)
            expect(post1).to.be.bignumber.eq(new BN(pre1).add(new BN(cl1)))
            expect(post2).to.be.bignumber.eq(new BN(pre2).add(new BN(cl2)))
            expect(post3).to.be.bignumber.eq(new BN(pre3).add(new BN(cl3)))
        })

    })
    describe('data storage moves check', async function () {
        it('cleans user data', async function () {
            // advance time to close everything
            await time.increaseTo(timeStart + (week * 5))
            // check user polls after claim, should left only pool 3
            const u1 = await stake.getUserStakes(user1)
            const u2 = await stake.getUserStakes(user2)
            const u3 = await stake.getUserStakes(user3)
            // user 1 have no rewards left, user 2 one, user 3 - two
            expect(u1.length).to.eq(0)
            expect(u2.length).to.eq(1)
            expect(u3.length).to.eq(2)
            expect(u2[0].totalAmount).to.be.bignumber.eq(toWei('15', 'ether')) //10+50%
            //swapped after earlier claim
            expect(u3[1].totalAmount).to.be.bignumber.eq(toWei('15', 'ether')) //10+50%
            expect(u3[0].totalAmount).to.be.bignumber.eq(toWei('3', 'ether')) //2+50%
        })
        it('cleanup closed pools', async function () {
            //check free rewards
            let ret = await stake.rewardsAvailable()
            //reclaim rewards by owner
            const pre = await token.balanceOf(owner)
            await stake.reclaimRewards({ from: owner })
            const post = await token.balanceOf(owner)
            expect(ret).to.be.bignumber.eq(new BN(post).sub(new BN(pre)))
            ret = await stake.getPools();
            expect(ret.length).to.eq(0)
            expect(await stake.rewardsAvailable()).to.be.bignumber.eq('0')
        })
        it('Claims after cleaned pools', async function () {
            //claim by user after owner reclaim
            const pre1 = await token.balanceOf(user1)
            const pre2 = await token.balanceOf(user2)
            const pre3 = await token.balanceOf(user3)

            await expectRevert(stake.claim({ from: user1 }), "No stakes for user")
            await stake.claim({ from: user2 })
            await stake.claim({ from: user3 })

            const post1 = await token.balanceOf(user1)
            const post2 = await token.balanceOf(user2)
            const post3 = await token.balanceOf(user3)

            expect(post1.sub(pre1)).to.be.bignumber.eq('0')
            expect(post2.sub(pre2)).to.be.bignumber.eq(toWei('15', 'ether'))//10 + 50%
            expect(post3.sub(pre3)).to.be.bignumber.eq(toWei('18', 'ether'))//12 + 50%

        })
    })
})
