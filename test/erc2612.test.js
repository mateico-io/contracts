const { accounts, contract, privateKeys } = require('@openzeppelin/test-environment');
const {
    BN,           // Big Number support
    time,
    expectRevert, // Assertions for transactions that should fail
} = require('@openzeppelin/test-helpers');

const { expect } = require('chai');

// signatures
const { fromRpcSig } = require('ethereumjs-util');
const ethSigUtil = require('eth-sig-util');
const abi = require('ethereumjs-abi');

const { EIP712Domain, domainSeparator } = require('./eip712');

const Erc20 = contract.fromArtifact('Token');

const Permit = [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
];

describe('ERC2612-test', function () {
    const [owner, user1, user2, user3] = accounts;
    const [ownerPriv, u1Priv, u2Priv, u3Priv] = privateKeys;

    const name = 'Mateico';
    const symbol = 'MATE';

    const tentho = new BN(10000);
    const sto = new BN(100);

    let token;
    let DOMAIN_SEPARATOR;
    let CHAINID;
    let EIP712_DOMAIN_TYPEHASH;
    const version = '1';
    let verifyingContract;

    before(async function () {
        token = await Erc20.new(name, symbol, version, tentho, { from: owner });
        DOMAIN_SEPARATOR = await token.DOMAIN_SEPARATOR();
        CHAINID = await token.CHAINID();
        EIP712_DOMAIN_TYPEHASH = await token.EIP712_DOMAIN_TYPEHASH();
        verifyingContract = token.address;
    });

    describe('Signature hashes checks', function () {
        it('Typehash check', async function () {
            let typehash = abi.soliditySHA3(["string"],
                ['EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)'])
            expect(EIP712_DOMAIN_TYPEHASH).to.eql('0x' + typehash.toString('hex'), "eip721 typehash mismatch")
        })
        it("Domain separator check", async function () {
            //check domain separator
            let domain = await domainSeparator(name, version, CHAINID, token.address)
            expect(DOMAIN_SEPARATOR).to.eql(domain, "Domain mismatch")
        })
        it('Permit hash check', async function () {
            //check permit_typehash
            let permit = abi.soliditySHA3(["string"], ["Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"])
            expect(await token.PERMIT_TYPEHASH()).to.eq('0x' + permit.toString('hex'), "Typehash mismatch")
        })

    })
    describe('Approval checks', function () {

        const buildData = (owner, spender, value, nonce, deadline, chainId) => ({
            primaryType: 'Permit',
            types: { EIP712Domain, Permit },
            domain: { name, version, chainId, verifyingContract },
            message: { owner, spender, value, nonce, deadline },
        });

        it('Can approve by signature', async function () {
            //prepare sig
            let timeNow = await time.latest()
            deadline = timeNow + 100;
            let nonce = await token.nonces(owner)
            expect(nonce).to.be.bignumber.eq('0')
            const data = buildData(owner, user1, sto, nonce, deadline, CHAINID);
            let priv = new Uint8Array(Buffer.from(ownerPriv.slice(2), 'hex'))
            const signature = ethSigUtil.signTypedMessage(priv, { data });
            const { v, r, s } = fromRpcSig(signature);
            //send 
            await token.permit(owner, user1, sto, deadline, v, r, s);
            //check approval
            expect(await token.nonces(owner)).to.be.bignumber.equal('1');
            expect(await token.allowance(owner, user1)).to.be.bignumber.equal(sto);

            // try use same nonce
            await expectRevert(token.permit(owner, user1, sto, deadline, v, r, s),
                "EIP2612: invalid signature");

        })

        it('Throws on wrong signature', async function () {
            let timeNow = await time.latest()
            deadline = timeNow + 100;
            let nonce = await token.nonces(user2)
            expect(nonce).to.be.bignumber.eq('0')
            //prepare for user2
            const data = buildData(user2, user1, sto, nonce, deadline, CHAINID);
            // sign by user3
            let priv = new Uint8Array(Buffer.from(u3Priv.slice(2), 'hex'))
            const signature = ethSigUtil.signTypedMessage(priv, { data });
            const { v, r, s } = fromRpcSig(signature);
            //send
            await expectRevert(token.permit(user2, user1, sto, deadline, v, r, s),
                "EIP2612: invalid signature");
        })
        it('Throws on timeout', async function () {
            let timeNow = await time.latest()
            deadline = timeNow - 100;
            let nonce = await token.nonces(owner)
            expect(nonce).to.be.bignumber.eq('1')
            const data = buildData(owner, user1, sto, nonce, deadline, CHAINID);
            let priv = new Uint8Array(Buffer.from(ownerPriv.slice(2), 'hex'))
            const signature = ethSigUtil.signTypedMessage(priv, { data });
            const { v, r, s } = fromRpcSig(signature);
            //send
            await expectRevert(token.permit(owner, user1, sto, deadline, v, r, s),
                "EIP2612: permit is expired");
        })
    })
})
