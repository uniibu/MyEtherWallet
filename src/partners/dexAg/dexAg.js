import BigNumber from 'bignumber.js';

import { ERC20, networkSymbols, EthereumTokens } from '../partnersConfig';

import {
  ChangellyCurrencies,
  TIME_SWAP_VALID,
  PROVIDER_NAME,
  PROXY_CONTRACT_ADDRESS,
  SUPPORTED_DEXES
} from './config';
import dexAgCalls from './dexAg-calls';
import { Toast } from '@/helpers';

import debug from 'debug';
import { utils } from '@/partners';

const errorLogger = debug('v5:partners-dexag');

export default class DexAg {
  constructor(props = {}) {
    this.name = DexAg.getName();
    this.baseCurrency = 'ETH';
    this.network = props.network || networkSymbols.ETH;
    this.EthereumTokens = EthereumTokens;
    this.getRateForUnit =
      typeof props.getRateForUnit === 'boolean' ? props.getRateForUnit : false;
    this.hasRates = 0;
    this.currencyDetails = props.currencies || ChangellyCurrencies;
    this.useFixed = true;
    this.tokenDetails = {};
    this.web3 = props.web3;
    this.getSupportedDexes();
    this.getSupportedCurrencies(this.network);
  }

  static getName() {
    return PROVIDER_NAME;
  }

  static isDex() {
    return true;
  }

  async getSupportedDexes() {
    try {
      this.SUPPORTED_DEXES = await dexAgCalls.supportedDexes();
      if (!this.SUPPORTED_DEXES) {
        this.SUPPORTED_DEXES = SUPPORTED_DEXES;
      }
    } catch (e) {
      this.SUPPORTED_DEXES = SUPPORTED_DEXES;
    }
  }

  async getSupportedCurrencies() {
    try {
      const {
        currencyDetails,
        tokenDetails
      } = await dexAgCalls.getSupportedCurrencies(this.network);
      this.currencyDetails = currencyDetails;
      this.tokenDetails = tokenDetails;
      this.hasRates =
        Object.keys(this.tokenDetails).length > 0 ? this.hasRates + 1 : 0;
    } catch (e) {
      errorLogger(e);
    }
  }

  get ratesRetrieved() {
    return Object.keys(this.tokenDetails).length > 0 && this.hasRates > 0;
  }

  get isValidNetwork() {
    return this.network === networkSymbols.ETH;
  }

  setNetwork(network) {
    this.network = network;
  }

  get currencies() {
    if (this.isValidNetwork) {
      return this.currencyDetails;
    }
    return {};
  }

  validSwap(fromCurrency, toCurrency) {
    if (this.isValidNetwork) {
      return this.currencies[fromCurrency] && this.currencies[toCurrency];
    }
    return false;
  }

  calculateRate(inVal, outVal) {
    return new BigNumber(outVal).div(inVal);
  }

  async getRate(fromCurrency, toCurrency, fromValue) {
    return new Promise(resolve => {
      const wrapGetRate = async () => {
        const vals = await dexAgCalls.getPrice(
          fromCurrency,
          toCurrency,
          fromValue
        );

        resolve(
          vals.map(val => {
            const isKnownToWork = this.SUPPORTED_DEXES.includes(val.dex);
            return {
              fromCurrency,
              toCurrency,
              provider: val.dex !== 'ag' ? val.dex : 'dexag',
              rate: isKnownToWork ? val.price : 0,
              additional: { source: 'dexag' }
            };
          })
        );
      };
      wrapGetRate();
    });
  }

  async getRateUpdate(fromCurrency, toCurrency, fromValue, toValue, isFiat) {
    return this.getRate(fromCurrency, toCurrency, fromValue, toValue, isFiat);
  }

  getInitialCurrencyEntries(collectMapFrom, collectMapTo) {
    for (const prop in this.currencies) {
      if (this.currencies[prop])
        collectMapTo.set(prop, {
          symbol: prop,
          name: this.currencies[prop].name
        });
      collectMapFrom.set(prop, {
        symbol: prop,
        name: this.currencies[prop].name
      });
    }
  }

  getUpdatedFromCurrencyEntries(value, collectMap) {
    if (this.currencies[value.symbol]) {
      for (const prop in this.currencies) {
        if (this.currencies[prop])
          collectMap.set(prop, {
            symbol: prop,
            name: this.currencies[prop].name
          });
      }
    }
  }

  getUpdatedToCurrencyEntries(value, collectMap) {
    if (this.currencies[value.symbol]) {
      for (const prop in this.currencies) {
        if (this.currencies[prop])
          collectMap.set(prop, {
            symbol: prop,
            name: this.currencies[prop].name
          });
      }
    }
  }

  async approve(tokenAddress, spender, fromValueWei, higherGasLimit = false) {
    try {
      const methodObject = new this.web3.eth.Contract(
        ERC20,
        tokenAddress
      ).methods.approve(spender, fromValueWei);
      const values = {
        to: tokenAddress,
        value: 0,
        data: methodObject.encodeABI()
      };
      if (higherGasLimit) {
        values.gas = 50000;
      }
      return values;
    } catch (e) {
      errorLogger(e);
    }
  }

  async prepareApprovals(fromAddress, proxyAddress, fromCurrency, metadata) {
    const contract = new this.web3.eth.Contract(
      [
        {
          constant: true,
          inputs: [],
          name: 'approvalHandler',
          outputs: [
            {
              name: '',
              type: 'address'
            }
          ],
          payable: false,
          stateMutability: 'view',
          type: 'function'
        }
      ],
      PROXY_CONTRACT_ADDRESS
    );
    const providerAddress = await contract.methods.approvalHandler().call();
    const isTokenApprovalNeeded = async (fromToken, fromAddress) => {
      if (fromToken === this.baseCurrency)
        return { approve: false, reset: false };

      const currentAllowance = await new this.web3.eth.Contract(
        ERC20,
        metadata.input.address
      ).methods
        .allowance(fromAddress, providerAddress)
        .call();

      if (new BigNumber(currentAllowance).gt(new BigNumber(0))) {
        if (
          new BigNumber(currentAllowance)
            .minus(new BigNumber(metadata.input.amount))
            .lt(new BigNumber(0))
        ) {
          return { approve: true, reset: true };
        }
        return { approve: false, reset: false };
      }
      return { approve: true, reset: false };
    };

    const { approve, reset } = await isTokenApprovalNeeded(
      fromCurrency,
      fromAddress
    );
    if (approve && reset) {
      return new Set(
        await Promise.all([
          await this.approve(metadata.input.address, providerAddress, 0),
          await this.approve(
            metadata.input.address,
            providerAddress,
            metadata.input.amount,
            true
          )
        ])
      );
    } else if (approve) {
      return new Set([
        await this.approve(
          metadata.input.address,
          providerAddress,
          metadata.input.amount
        )
      ]);
    }
    return new Set();
  }

  async generateDataForTransactions(
    providerAddress,
    swapDetails,
    tradeDetails
  ) {
    try {
      const preparedTradeTxs = await this.prepareApprovals(
        swapDetails.fromAddress,
        providerAddress,
        swapDetails.fromCurrency,
        tradeDetails.metadata
      );

      const tx = {
        to: tradeDetails.trade.to,
        data: tradeDetails.trade.data,
        value: tradeDetails.trade.value
      };
      if (tradeDetails.metadata.gasPrice) {
        tx.gasPrice = tradeDetails.metadata.gasPrice;
      }

      if (preparedTradeTxs.size > 0) {
        switch (swapDetails.provider) {
          case 'curvefi':
            tx.gas = 2000000;
            break;
          case 'zero_x':
            tx.gas = 1000000;
            break;
          default:
            tx.gas = 500000;
        }
      }

      preparedTradeTxs.add(tx);

      const swapTransactions = Array.from(preparedTradeTxs);

      return [...swapTransactions];
    } catch (e) {
      errorLogger(e);
      throw e;
    }
  }

  async startSwap(swapDetails) {
    swapDetails.maybeToken = true;

    const dexToUse = this.SUPPORTED_DEXES.includes(swapDetails.provider)
      ? swapDetails.provider
      : 'ag';

    const tradeDetails = await this.createTransaction(swapDetails, dexToUse);
    if (tradeDetails.error) {
      Toast.responseHandler(tradeDetails.error, 1);
      throw Error('abort');
    }
    const providerAddress = tradeDetails.metadata.input
      ? tradeDetails.metadata.input.spender
        ? tradeDetails.metadata.input.spender
        : tradeDetails.trade.to
      : tradeDetails.trade.to;

    swapDetails.dataForInitialization = await this.generateDataForTransactions(
      providerAddress,
      { ...swapDetails },
      tradeDetails
    );

    swapDetails.isExitToFiat = false;
    swapDetails.providerReceives = swapDetails.fromValue;
    swapDetails.providerSends = tradeDetails.metadata.query.toAmount;
    swapDetails.providerAddress = providerAddress;

    swapDetails.parsed = {
      sendToAddress: swapDetails.providerAddress,
      status: 'pending',
      validFor: TIME_SWAP_VALID,
      timestamp: new Date(Date.now()).toISOString()
    };
    swapDetails.isDex = DexAg.isDex();

    return swapDetails;
  }

  static async getOrderStatus() {
    return 'pending';
  }

  async createTransaction(swapDetails, dexToUse) {
    return dexAgCalls.createTransaction({ dex: dexToUse, ...swapDetails });
  }

  getTokenAddress(token) {
    try {
      if (utils.stringEqual(networkSymbols.ETH, token)) {
        return this.EthereumTokens[token].contractAddress;
      }
      return this.web3.utils.toChecksumAddress(
        this.EthereumTokens[token].contractAddress
      );
    } catch (e) {
      errorLogger(e);
      throw Error(`Token [${token}] not included in dex.ag list of tokens`);
    }
  }

  getTokenDecimals(token) {
    try {
      return new BigNumber(this.EthereumTokens[token].decimals).toNumber();
    } catch (e) {
      errorLogger(e);
      throw Error(
        `Token [${token}] not included in dex.ag network list of tokens`
      );
    }
  }

  convertToTokenBase(token, value) {
    const decimals = this.getTokenDecimals(token);
    const denominator = new BigNumber(10).pow(decimals);
    return new BigNumber(value).div(denominator).toString(10);
  }

  convertToTokenWei(token, value) {
    const decimals = this.getTokenDecimals(token);
    const denominator = new BigNumber(10).pow(decimals);
    return new BigNumber(value)
      .times(denominator)
      .integerValue(BigNumber.ROUND_DOWN)
      .toString(10);
  }
}