import * as chai from 'chai';
import '../custom-matchers';
import {utils, EIP712Signer} from '../../src';
import {ethers} from 'ethers';

const {expect} = chai;

describe('EIP712Signer', () => {
  describe('#getSignInput()', () => {
    it('should return a populated transaction', async () => {
      const tx = {
        txType: utils.EIP712_TX_TYPE,
        from: '0x36615Cf349d7F6344891B1e7CA7C72883F5dc049',
        to: '0xa61464658AfeAf65CccaaFD3a512b69A83B77618',
        gasLimit: BigInt(21_000),
        gasPerPubdataByteLimit: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
        maxFeePerGas: BigInt(250_000_000),
        maxPriorityFeePerGas: BigInt(250_000_000),
        paymaster: ethers.ZeroAddress,
        nonce: 0,
        value: BigInt(7_000_000),
        data: '0x',
        factoryDeps: [],
        paymasterInput: '0x',
      };

      const result = EIP712Signer.getSignInput({
        type: utils.EIP712_TX_TYPE,
        to: '0xa61464658AfeAf65CccaaFD3a512b69A83B77618',
        value: BigInt(7_000_000),
        from: '0x36615Cf349d7F6344891B1e7CA7C72883F5dc049',
        nonce: 0,
        chainId: BigInt(270),
        gasPrice: BigInt(250_000_000),
        gasLimit: BigInt(21_000),
        customData: {},
      });
      expect(result).to.be.deep.equal(tx);
    });

    it('should return a populated transaction with default values', async () => {
      const tx = {
        txType: utils.EIP712_TX_TYPE,
        from: '0x36615Cf349d7F6344891B1e7CA7C72883F5dc049',
        to: '0xa61464658AfeAf65CccaaFD3a512b69A83B77618',
        gasLimit: BigInt(0),
        gasPerPubdataByteLimit: utils.DEFAULT_GAS_PER_PUBDATA_LIMIT,
        maxFeePerGas: BigInt(0),
        maxPriorityFeePerGas: BigInt(0),
        paymaster: ethers.ZeroAddress,
        nonce: 0,
        value: BigInt(0),
        data: '0x',
        factoryDeps: [],
        paymasterInput: '0x',
      };

      const result = EIP712Signer.getSignInput({
        type: utils.EIP712_TX_TYPE,
        to: '0xa61464658AfeAf65CccaaFD3a512b69A83B77618',
        from: '0x36615Cf349d7F6344891B1e7CA7C72883F5dc049',
      });
      expect(result).to.be.deep.equal(tx);
    });
  });

  describe('#getSignedDigest()', () => {
    it('should throw an error when chain ID is not specified', async () => {
      try {
        EIP712Signer.getSignedDigest({});
      } catch (e) {
        expect((e as Error).message).to.be.equal(
          "Transaction chainId isn't set!"
        );
      }
    });
  });
});
