// Based on https://github.com/CoinbaseStablecoin/eip-3009

const { accounts, contract, privateKeys } = require('@openzeppelin/test-environment');
const {
    constants,    // Common constants, like the zero address and largest integers
    expectEvent,  // Assertions for emitted events
    expectRevert, // Assertions for transactions that should fail
    time
} = require('@openzeppelin/test-helpers');

const { expect } = require('chai');
const { MAX_UINT256 } = constants;

// signatures
const { ecsign } = require('ethereumjs-util');

const abi = require('ethereumjs-abi');

const web3 = require('web3')

const Erc20 = contract.fromArtifact('Token');

const TRANSFER_WITH_AUTHORIZATION_TYPEHASH = web3.utils.keccak256(
    "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
);

const RECEIVE_WITH_AUTHORIZATION_TYPEHASH = web3.utils.keccak256(
    "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
);

const CANCEL_AUTHORIZATION_TYPEHASH = web3.utils.keccak256(
    "CancelAuthorization(address authorizer,bytes32 nonce)"
);

describe('ERC3009-test', function () {
    const [owner, user1, user2, user3] = accounts;
    const [op0x, u1Priv, u20x, u3Priv] = privateKeys;
    const ownerPriv = op0x.slice(2)
    const u2Priv = u20x.slice(2)
    const name = 'Mateico';
    const symbol = 'MATE';

    let token;
    let domainSeparator;
    let nonce;
    let initialBalance = 10e6;

    beforeEach(async function () {
        token = await Erc20.new(name, symbol, "1", initialBalance, { from: owner });
        domainSeparator = await token.DOMAIN_SEPARATOR();
        nonce = web3.utils.randomHex(32);
    });

    it('has proper sighashes', async function () {
        expect(await token.TRANSFER_WITH_AUTHORIZATION_TYPEHASH()).to.equal(
            TRANSFER_WITH_AUTHORIZATION_TYPEHASH
        );

        expect(await token.RECEIVE_WITH_AUTHORIZATION_TYPEHASH()).to.equal(
            RECEIVE_WITH_AUTHORIZATION_TYPEHASH
        );

        expect(await token.CANCEL_AUTHORIZATION_TYPEHASH()).to.equal(
            CANCEL_AUTHORIZATION_TYPEHASH
        );
    })

    describe("transferWithAuthorization", () => {
        const transferParams = {
            from: owner,
            to: user2,
            value: 7e6,
            validAfter: 0,
            validBefore: MAX_UINT256,
        };

        it("executes a transfer when a valid authorization is given", async () => {
            const { from, to, value, validAfter, validBefore } = transferParams;
            // create an authorization to transfer money from Owner to user2 and sign
            // with Ownerkey
            const { v, r, s } = signTransferAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // check initial balance
            expect((await token.balanceOf(from)).toNumber()).to.equal(10e6);
            expect((await token.balanceOf(to)).toNumber()).to.equal(0);

            expect(await token.authorizationState(from, nonce)).to.be.false;

            // a third-party, user3 (not Owner) submits the signed authorization
            const result = await token.transferWithAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                v,
                r,
                s,
                { from: user3 }
            );

            // check that balance is updated
            expect((await token.balanceOf(from)).toNumber()).to.equal(
                initialBalance - value
            );
            expect((await token.balanceOf(to)).toNumber()).to.equal(value);

            // check that AuthorizationUsed event is emitted
            expectEvent(result, "AuthorizationUsed",
                {
                    authorizer: from,
                    nonce: nonce
                })

            // check that Transfer event is emitted
            expectEvent(result, "Transfer",
                {
                    from: from,
                    to: to,
                    value: String(value)
                })

            // check that the authorization is now used
            expect(await token.authorizationState(from, nonce)).to.be.true;
        });

        it("reverts if the signature does not match given parameters", async () => {
            const { from, to, value, validAfter, validBefore } = transferParams;
            // create a signed authorization
            const { v, r, s } = signTransferAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to cheat by claiming the transfer amount is double
            await expectRevert(
                token.transferWithAuthorization(
                    from,
                    to,
                    value * 2, // pass incorrect value
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: Invalid signature"
            );
        });

        it("reverts if the signature is not signed with the right key", async () => {
            const { from, to, value, validAfter, validBefore } = transferParams;
            // create an authorization to transfer money from Owner to user2, but
            // sign with user2's key instead of Owner's
            const { v, r, s } = signTransferAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                u2Priv
            );

            // try to cheat by submitting the signed authorization that is signed by
            // a wrong person
            await expectRevert(
                token.transferWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: Invalid signature"
            );
        });

        it("reverts if the authorization is not yet valid", async () => {
            const { from, to, value, validBefore } = transferParams;
            // create a signed authorization that won't be valid until 10 seconds
            // later
            let timeNow = await time.latest()
            const validAfter = timeNow + 10;
            const { v, r, s } = signTransferAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to submit the authorization early
            await expectRevert(
                token.transferWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: authorization is not yet valid"
            );
        });

        it("reverts if the authorization is expired", async () => {
            // create a signed authorization that expires immediately
            const { from, to, value, validAfter } = transferParams;
            let timeNow = await time.latest()
            const validBefore = timeNow - 1
            const { v, r, s } = signTransferAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to submit the authorization that is expired
            await expectRevert(
                token.transferWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: authorization is expired"
            );
        });

        it("reverts if the authorization has already been used", async () => {
            const { from, to, validAfter, validBefore } = transferParams;
            // create a signed authorization
            const value = 1e6;
            const { v, r, s } = signTransferAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // submit the authorization
            await token.transferWithAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                v,
                r,
                s,
                { from: user3 }
            );

            // try to submit the authorization again
            await expectRevert(
                token.transferWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: Authorization reused"
            );
        });

        it("reverts if the authorization has a nonce that has already been used by the signer", async () => {
            const { from, to, value, validAfter, validBefore } = transferParams;
            // create a signed authorization
            const authorization = signTransferAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // submit the authorization
            await token.transferWithAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                authorization.v,
                authorization.r,
                authorization.s,
                { from: user3 }
            );

            // create another authorization with the same nonce, but with different
            // parameters
            const authorization2 = signTransferAuthorization(
                from,
                to,
                1e6,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to submit the authorization again
            await expectRevert(
                token.transferWithAuthorization(
                    from,
                    to,
                    1e6,
                    validAfter,
                    validBefore,
                    nonce,
                    authorization2.v,
                    authorization2.r,
                    authorization2.s,
                    { from: user3 }
                ),
                "EIP3009: Authorization reused"
            );
        });

        it("reverts if the authorization includes invalid transfer parameters", async () => {
            const { from, to, validAfter, validBefore } = transferParams;
            // create a signed authorization that attempts to transfer an amount
            // that exceeds the sender's balance
            const value = initialBalance + 1;
            const { v, r, s } = signTransferAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to submit the authorization with invalid transfer parameters
            await expectRevert(
                token.transferWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "ERC20: balance to low"
            );
        });

        it("reverts if the authorization is not for transferWithAuthorization", async () => {
            const {
                from: owner,
                to: spender,
                value,
                validAfter,
                validBefore,
            } = transferParams;
            // create a signed authorization for an approval (granting allowance)
            const { v, r, s } = signReceiveAuthorization(
                owner,
                spender,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to submit the approval authorization
            await expectRevert(
                token.transferWithAuthorization(
                    owner,
                    spender,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: Invalid signature"
            );
        });
    });

    describe("receiveWithAuthorization", () => {
        const receiveParams = {
            from: owner,
            to: user3,
            value: 7e6,
            validAfter: 0,
            validBefore: MAX_UINT256,
        };

        it("executes a transfer when a valid authorization is submitted by the payee", async () => {
            const { from, to, value, validAfter, validBefore } = receiveParams;
            // create a receive authorization to transfer money from Owner to user3
            // and sign with Ownerkey
            const { v, r, s } = signReceiveAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // check initial balance
            expect((await token.balanceOf(from)).toNumber()).to.equal(10e6);
            expect((await token.balanceOf(to)).toNumber()).to.equal(0);

            expect(await token.authorizationState(from, nonce)).to.be.false;

            // The payee submits the signed authorization
            const result = await token.receiveWithAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                v,
                r,
                s,
                { from: user3 }
            );

            // check that balance is updated
            expect((await token.balanceOf(from)).toNumber()).to.equal(
                initialBalance - value
            );
            expect((await token.balanceOf(to)).toNumber()).to.equal(value);

            // check that AuthorizationUsed event is emitted
            expectEvent(result, "AuthorizationUsed", {
                authorizer: from,
                nonce: nonce
            })

            // check that Transfer event is emitted
            expectEvent(result, "Transfer", {
                from: from,
                to: to,
                value: String(value)
            })
            // check that the authorization is now used
            expect(await token.authorizationState(from, nonce)).to.be.true;
        });

        it("reverts if the caller is not the payee", async () => {
            const { from, to, value, validAfter, validBefore } = receiveParams;
            // create a signed authorization
            const { v, r, s } = signReceiveAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // check initial balance
            expect((await token.balanceOf(from)).toNumber()).to.equal(10e6);
            expect((await token.balanceOf(to)).toNumber()).to.equal(0);

            expect(await token.authorizationState(from, nonce)).to.be.false;

            // The payee submits the signed authorization
            await expectRevert(
                token.receiveWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: owner }
                ),
                "EIP3009: caller must be the payee"
            );
        });

        it("reverts if the signature does not match given parameters", async () => {
            const { from, to, value, validAfter, validBefore } = receiveParams;
            // create a signed authorization
            const { v, r, s } = signReceiveAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to cheat by claiming the transfer amount is double
            await expectRevert(
                token.receiveWithAuthorization(
                    from,
                    to,
                    value * 2, // pass incorrect value
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: Invalid signature"
            );
        });

        it("reverts if the signature is not signed with the right key", async () => {
            const { from, to, value, validAfter, validBefore } = receiveParams;
            // create an authorization to transfer money from Owner to user2, but
            // sign with user2's key instead of Owner's
            const { v, r, s } = signReceiveAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                u2Priv
            );

            // try to cheat by submitting the signed authorization that is signed by
            // a wrong person
            await expectRevert(
                token.receiveWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: Invalid signature"
            );
        });

        it("reverts if the authorization is not yet valid", async () => {
            const { from, to, value, validBefore } = receiveParams;
            // create a signed authorization that won't be valid until 10 seconds
            // later
            let timeNow = await time.latest()
            const validAfter = timeNow + 10;
            const { v, r, s } = signReceiveAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to submit the authorization early
            await expectRevert(
                token.receiveWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: authorization is not yet valid"
            );
        });

        it("reverts if the authorization is expired", async () => {
            // create a signed authorization that expires immediately
            const { from, to, value, validAfter } = receiveParams;
            let timeNow = await time.latest()
            const validBefore = timeNow - 1;
            const { v, r, s } = signReceiveAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to submit the authorization that is expired
            await expectRevert(
                token.receiveWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: authorization is expired"
            );
        });

        it("reverts if the authorization has already been used", async () => {
            const { from, to, validAfter, validBefore } = receiveParams;
            // create a signed authorization
            const value = 1e6;
            const { v, r, s } = signReceiveAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // submit the authorization
            await token.receiveWithAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                v,
                r,
                s,
                { from: user3 }
            );

            // try to submit the authorization again
            await expectRevert(
                token.receiveWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: Authorization reused"
            );
        });

        it("reverts if the authorization has a nonce that has already been used by the signer", async () => {
            const { from, to, value, validAfter, validBefore } = receiveParams;
            // create a signed authorization
            const authorization = signReceiveAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // submit the authorization
            await token.receiveWithAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                authorization.v,
                authorization.r,
                authorization.s,
                { from: user3 }
            );

            // create another authorization with the same nonce, but with different
            // parameters
            const authorization2 = signReceiveAuthorization(
                from,
                to,
                1e6,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to submit the authorization again
            await expectRevert(
                token.receiveWithAuthorization(
                    from,
                    to,
                    1e6,
                    validAfter,
                    validBefore,
                    nonce,
                    authorization2.v,
                    authorization2.r,
                    authorization2.s,
                    { from: user3 }
                ),
                "EIP3009: Authorization reused"
            );
        });

        it("reverts if the authorization includes invalid transfer parameters", async () => {
            const { from, to, validAfter, validBefore } = receiveParams;
            // create a signed authorization that attempts to transfer an amount
            // that exceeds the sender's balance
            const value = initialBalance + 1;
            const { v, r, s } = signReceiveAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to submit the authorization with invalid transfer parameters
            await expectRevert(
                token.receiveWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "ERC20: balance to low"
            );
        });

        it("reverts if the authorization is not for receiveWithAuthorization", async () => {
            const {
                from: owner,
                to: spender,
                value,
                validAfter,
                validBefore,
            } = receiveParams;
            // create a signed authorization for an approval (granting allowance)
            const { v, r, s } = signTransferAuthorization(
                owner,
                spender,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // try to submit the approval authorization
            await expectRevert(
                token.receiveWithAuthorization(
                    owner,
                    spender,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    v,
                    r,
                    s,
                    { from: user3 }
                ),
                "EIP3009: Invalid signature"
            );
        });
    });

    describe("cancelAuthorization", () => {
        it("cancels an unused transfer authorization if the signature is valid", async () => {
            const from = owner;
            const to = user2;
            const value = 7e6;
            const validAfter = 0;
            const validBefore = MAX_UINT256;

            // create a signed authorization
            const authorization = signTransferAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // create cancellation
            const cancellation = signCancelAuthorization(
                from,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // check that the authorization is unused
            expect(await token.authorizationState(from, nonce)).to.be.false;

            // cancel the authorization
            await token.cancelAuthorization(
                from,
                nonce,
                cancellation.v,
                cancellation.r,
                cancellation.s,
                { from: user3 }
            );

            // check that the authorization is now used
            expect(await token.authorizationState(from, nonce)).to.be.true;

            // attempt to use the canceled authorization
            await expectRevert(
                token.transferWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    authorization.v,
                    authorization.r,
                    authorization.s,
                    { from: user3 }
                ),
                "EIP3009: Authorization reused"
            );
        });

        it("cancels an unused receive authorization if the signature is valid", async () => {
            const from = owner;
            const to = user3;
            const value = 7e6;
            const validAfter = 0;
            const validBefore = MAX_UINT256;

            // create a signed authorization
            const authorization = signReceiveAuthorization(
                from,
                to,
                value,
                validAfter,
                validBefore,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // create cancellation
            const cancellation = signCancelAuthorization(
                from,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // check that the authorization is unused
            expect(await token.authorizationState(from, nonce)).to.be.false;

            // cancel the authorization
            await token.cancelAuthorization(
                from,
                nonce,
                cancellation.v,
                cancellation.r,
                cancellation.s,
                { from: user3 }
            );

            // check that the authorization is now used
            expect(await token.authorizationState(from, nonce)).to.be.true;

            // attempt to use the canceled authorization
            await expectRevert(
                token.receiveWithAuthorization(
                    from,
                    to,
                    value,
                    validAfter,
                    validBefore,
                    nonce,
                    authorization.v,
                    authorization.r,
                    authorization.s,
                    { from: user3 }
                ),
                "EIP3009: Authorization reused"
            );
        });

        it("reverts if the authorization is already canceled", async () => {
            // create cancellation
            const cancellation = signCancelAuthorization(
                owner,
                nonce,
                domainSeparator,
                ownerPriv
            );

            // submit the cancellation
            await token.cancelAuthorization(
                owner,
                nonce,
                cancellation.v,
                cancellation.r,
                cancellation.s,
                { from: user3 }
            );

            // try to submit the same cancellation again
            await expectRevert(
                token.cancelAuthorization(
                    owner,
                    nonce,
                    cancellation.v,
                    cancellation.r,
                    cancellation.s,
                    { from: user3 }
                ),
                "EIP3009: Authorization reused"
            );
        });
    });
})


function prepend0x(v) {
    return v.replace(/^(0x)?/, "0x");
}

function strip0x(v) {
    return v.replace(/^0x/, "");
}

function hexStringFromBuffer(buf) {
    return "0x" + buf.toString("hex");
}

function bufferFromHexString(hex) {
    return Buffer.from(strip0x(hex), "hex");
}

function ecSign(digest, privateKey) {
    const { v, r, s } = ecsign(
        bufferFromHexString(digest),
        bufferFromHexString(privateKey)
    );

    return { v, r: hexStringFromBuffer(r), s: hexStringFromBuffer(s) };
}


function signTransferAuthorization(
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
    domainSeparator,
    privateKey
) {
    return signEIP712(
        domainSeparator,
        TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
        ["address", "address", "uint256", "uint256", "uint256", "bytes32"],
        [from, to, value, validAfter, validBefore, nonce],
        privateKey
    );
}

function signReceiveAuthorization(
    from,
    to,
    value,
    validAfter,
    validBefore,
    nonce,
    domainSeparator,
    privateKey
) {
    return signEIP712(
        domainSeparator,
        RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
        ["address", "address", "uint256", "uint256", "uint256", "bytes32"],
        [from, to, value, validAfter, validBefore, nonce],
        privateKey
    );
}

function signCancelAuthorization(
    signer,
    nonce,
    domainSeparator,
    privateKey
) {
    return signEIP712(
        domainSeparator,
        CANCEL_AUTHORIZATION_TYPEHASH,
        ["address", "bytes32"],
        [signer, nonce],
        privateKey
    );
}

function signEIP712(
    domainSeparator,
    typeHash,
    types,
    parameters,
    privateKey
) {
    const digest = web3.utils.keccak256(
        "0x1901" +
        strip0x(domainSeparator) +
        strip0x(
            web3.utils.keccak256(
                abi.rawEncode(
                    ["bytes32", ...types],
                    [typeHash, ...parameters]
                )
            )
        )
    );

    return ecSign(digest, privateKey);
}
