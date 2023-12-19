/* Autogenerated file. Do not edit manually. */
/* tslint:disable */
/* eslint-disable */

import { Contract, Interface, type ContractRunner } from "ethers";
import type {
  IPaymasterFlow,
  IPaymasterFlowInterface,
} from "../IPaymasterFlow";

const _abi = [
  {
    inputs: [
      {
        internalType: "address",
        name: "_token",
        type: "address",
      },
      {
        internalType: "uint256",
        name: "_minAllowance",
        type: "uint256",
      },
      {
        internalType: "bytes",
        name: "_innerInput",
        type: "bytes",
      },
    ],
    name: "approvalBased",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      {
        internalType: "bytes",
        name: "input",
        type: "bytes",
      },
    ],
    name: "general",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export class IPaymasterFlow__factory {
  static readonly abi = _abi;
  static createInterface(): IPaymasterFlowInterface {
    return new Interface(_abi) as IPaymasterFlowInterface;
  }
  static connect(
    address: string,
    runner?: ContractRunner | null
  ): IPaymasterFlow {
    return new Contract(address, _abi, runner) as unknown as IPaymasterFlow;
  }
}