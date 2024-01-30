import { Provider, Wallet, types } from "../src";
import { ethers, BigNumber } from "ethers";
import { ETH_ADDRESS, ETH_ADDRESS_IN_CONTRACTS } from "../src/utils";

import { ITestnetErc20TokenFactory } from "../typechain/ITestnetErc20TokenFactory";

const PRIVATE_KEY = "0x7726827caac94a7f9e1b160f7ea819f172f7b6f9d2a97f992c38edeab82d4110";

const provider = Provider.getDefaultProvider(types.Network.Localhost);
const ethProvider = ethers.getDefaultProvider("http://127.0.0.1:8545");

const wallet = new Wallet(PRIVATE_KEY, provider, ethProvider);

// const TOKENS_L1 = require("./tokens.json");
// const DAI_L1 = TOKENS_L1[0].address;

// only for zk stack because everytime tokens addresses are
// different
const DAI_L1 = "0x5E6D086F5eC079ADFF4FB3774CDf3e8D6a34F7E9";

/*
Deploy a token to the L2 network through deposit transaction.
 */
async function createTokenL2(l1TokenAddress: string): Promise<string> {
    const priorityOpResponse = await wallet.deposit({
        token: l1TokenAddress,
        to: await wallet.getAddress(),
        amount: 30,
        approveERC20: true,
        approveBaseERC20: true,
        refundRecipient: await wallet.getAddress(),
    });
    await priorityOpResponse.waitFinalize();
    return await wallet.l2TokenAddress(l1TokenAddress);
}

/*
Mints tokens on L1 in case L2 is non-ETH based chain.
It mints based token, provided alterative tokens (different from base token) and wETH.
*/
async function mintTokensOnL1(alternativeToken: string) {
    const bridgehub = await wallet.getBridgehubContract();
    const chainId = (await provider.getNetwork()).chainId;
    let baseTokenAddress = await bridgehub.baseToken(chainId);
    baseTokenAddress = baseTokenAddress == ETH_ADDRESS_IN_CONTRACTS ? ETH_ADDRESS : baseTokenAddress;
    if (baseTokenAddress == ETH_ADDRESS) {
        return;
    }

    console.log(`Minting tokens on L1`);

    const baseToken = ITestnetErc20TokenFactory.connect(baseTokenAddress, wallet._signerL1());
    const baseTokenMintTx = await baseToken.mint(
        await wallet.getAddress(),
        ethers.utils.parseEther("100"),
    );
    await baseTokenMintTx.wait();

    const altToken = ITestnetErc20TokenFactory.connect(alternativeToken, wallet._signerL1());
    const altTokenMintTx = await altToken.mint(
        await wallet.getAddress(),
        ethers.utils.parseEther("100"),
    );
    await altTokenMintTx.wait();

    const wethBridgeAbi = ["function l1WethAddress() view returns (address)"];
    const wethAbi = ["function deposit() public payable"];
    const wethBridge = new ethers.Contract(
        (await wallet.provider.getDefaultBridgeAddresses()).wethL1!,
        wethBridgeAbi,
        wallet._signerL1(),
    );
    const weth = new ethers.Contract(await wethBridge.l1WethAddress(), wethAbi, wallet._signerL1());
    const wethDepositTx = await weth.deposit({ value: ethers.utils.parseEther("100") });
    await wethDepositTx.wait();
}

/*
Send tokens to L2 in case L2 in non-ETH base chain.
*/
async function sendFundsOnL2() {
    const bridgehub = await wallet.getBridgehubContract();
    const chainId = (await provider.getNetwork()).chainId;
    let baseTokenAddress = await bridgehub.baseToken(chainId);
    baseTokenAddress = baseTokenAddress == ETH_ADDRESS_IN_CONTRACTS ? ETH_ADDRESS : baseTokenAddress;

    const priorityOpResponse = await wallet.deposit({
        token: baseTokenAddress,
        to: await wallet.getAddress(),
        amount: ethers.utils.parseEther("100"),
        approveERC20: true,
        refundRecipient: await wallet.getAddress(),
    });
    const receipt = await priorityOpResponse.waitFinalize();
    console.log(`Send funds tx: ${receipt.transactionHash}`);
}

async function main() {
    await mintTokensOnL1(DAI_L1);

    const l2TokenAddress = await createTokenL2(DAI_L1);
    console.log(`L2 DAI address: ${l2TokenAddress}`);

    await sendFundsOnL2();
}

main()
    .then()
    .catch((error) => {
        console.log(`Error: ${error}`);
    });
