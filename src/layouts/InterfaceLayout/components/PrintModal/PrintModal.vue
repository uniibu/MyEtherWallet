<template>
  <div class="modal-container">
    <b-modal
      ref="print"
      :title="$t('createWallet.mnemonic.print.print-title')"
      hide-footer
      centered
      class="nopadding print-mod"
      size="lg"
      static
      lazy
    >
      <div class="modal-content-container">
        <div ref="printContainer" class="print-modal">
          <div class="to-print">
            <account-content-to-print :address="address" />
          </div>
        </div>
        <div class="to-display">
          <account-content-to-display :address="address" />
        </div>
        <div class="button-container">
          <div class="print-button" @click="print">
            {{ $t('popover.print') }}
          </div>
        </div>
      </div>
    </b-modal>
  </div>
</template>
<script>
import printJS from 'print-js';
import html2canvas from 'html2canvas';
import AccountContentToDisplay from './components/AccountContentToDisplay';
import AccountContentToPrint from './components/AccountContentToPrint';
import { Toast } from '@/helpers';

export default {
  components: {
    'account-content-to-display': AccountContentToDisplay,
    'account-content-to-print': AccountContentToPrint
  },
  props: {
    address: {
      type: String,
      default: ''
    }
  },
  data() {
    return {};
  },
  methods: {
    async print() {
      try {
        const element = this.$refs.printContainer;
        const screen = await html2canvas(element, {
          async: true,
          logging: false
        }).then(canvas => {
          return canvas;
        });
        if (screen && screen.toDataURL !== '') {
          printJS({
            printable: screen.toDataURL('image/png'),
            type: 'image',
            onError: () => {
              Toast.responseHandler(
                this.$t('errorsGlobal.print-support-error'),
                Toast.ERROR
              );
            }
          });
        } else {
          Toast.responseHandler(
            this.$t('errorsGlobal.print-support-error'),
            Toast.ERROR
          );
        }
      } catch (e) {
        Toast.responseHandler(e, Toast.ERROR);
      }
    }
  }
};
</script>
<style lang="scss" scoped>
@import 'PrintModal.scss';
</style>
