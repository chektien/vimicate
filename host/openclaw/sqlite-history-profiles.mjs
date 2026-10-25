import { LEGACY_PROFILES } from './sqlite-history-profiles-legacy.mjs';

// Private canonical functions: verify before importing, re-audit on upgrades.
export const PROFILES = {
  ...LEGACY_PROFILES,
  '2026.10.2': { pins: {
    // 10.2 splits the watermark reader from the accessor writer bundle.
    // Cursor sequences may travel separately from display metadata.
    'chat-history-pages-BxZu7NVk.mjs': 'c9e3658a980f759013ca733cc2202d733b204e3d7c627167876eac15c82367fd',
    'chat-history-budget-BemkZVX3.mjs': '72bb04f2a4ed2cdae977afc9b6c10d4a4ee6361b90d8c0b41b94cfa39cea777f',
    'chat-history-page-kernel-5ARfr9qi.mjs': '7fd1eecefb6628945384bbc7ebb9cd551e631641e8775a3c5bebaef84da90e42',
    'session-transcript-readers-a1Q7LBmT.mjs': '65b381a9523f0f1c2548940e9bd20612e3a5580f1eea26b34b28cad1fd4dabb1',
    'transcript-image-artifacts-DqNH9hLC.mjs': '1cdb769c21fa0a2c311d7c87ccbaa9ce6c9b159a9dd53616899e91f9c2e02387',
    'session-accessor.sqlite-transcript-watermark-qvcdmNO-.mjs': '4cf75f0c1426013f24e9de6d73ef06138f53ace18dfc4aa0fba49d8fe91e7109',
    'session-accessor.sqlite-transcript-watermark-read-CRApP3Oa.mjs': '9adc8d78827aecadb6d1812bd2892084b4add5a995440839beb9874a83ca962c',
    'session-cold-storage-state-CzcE3h3O.mjs': 'c06a30da9441c3c3a45cb75943d29815363f878b3f693d58b7468594d924423a',
    'openclaw-agent-db-readonly-CixGQwG4.mjs': '8ed909bf212d96e8b30b9dbb97447dd2e8b2c86c721fbb6def2d17d38123d76d',
    'openclaw-agent-db-readonly-open-hQ4ohjUT.mjs': '80cfdea95c30e5f49c86e7e095ec5c3525a76e6377a0f085aa725299b5972f6a',
    'openclaw-agent-db-readonly-scope-CaYMBFUV.mjs': 'ca3c4407d6bf74eebd5f68fb3828e6a78c5f365616da17dd197f94cc53c7db0a',
    'session-history-worker-runtime-Dl9pfTux.mjs': 'c00babdb59b4617b680df126c2561e6894e46fa79d78b2ff39e2c86085c3c963',
    // Stock or exact rehearsed action-link flag forwarding; archive calls
    // omit that private-human flag and retain ignoreCliSessionImports.
    'session-history-worker-runtime-C6EVGZDH.mjs': ['1cad8ba65ed28153fd1ef640af4db9e95c3877436d069374dcba061401f70df1',
      '09bc3f19bb7b5666de91d16a6896e1144666fab21b3ebcbb94f1f287f027a97c'],
    'runtime-process-entrypoints-Dgz2IR4T.mjs': 'e461997c003d9dffc750471f288ef7bc442c54666f40fc38545b9323367f3c87',
    'plugin-sdk/session-store-runtime.js': 'c9bba1d40c5d07292344fe754457f1b51106a65967deeb15c17737bcf25401d3',
    'session-store-runtime-aDOZFdrM.mjs': '5ee62befcb4553157569c5db976f1ba3ce59a9faf52c2a90a10bd5c9342d964e',
    'session-accessor.sqlite-entry-Bu2LM31H.mjs': '29e485b6ce99636734c47e711cc80c559551eb9476a52a750e8ef48dc885704e',
  }, entrypoints: ['runtime-process-entrypoints-Dgz2IR4T.mjs', 'n'], bindings: {
    chat: {
      i: ['chat-history-pages-BxZu7NVk.mjs', 't'],
      r: ['chat-history-page-kernel-5ARfr9qi.mjs', 'n'],
      c: ['chat-history-budget-BemkZVX3.mjs', 's'],
      a: ['chat-history-page-kernel-5ARfr9qi.mjs', 'i'],
    },
    readers: ['session-transcript-readers-a1Q7LBmT.mjs', '_'],
    display: ['transcript-image-artifacts-DqNH9hLC.mjs', 'i'],
    accessor: ['session-accessor.sqlite-transcript-watermark-qvcdmNO-.mjs', 't'],
  } },
  '2026.10.4': { pins: {
    // 10.4 retains the audited 10.2 native reader and authority bodies.
    // Private import filenames changed; every selected port remains pinned.
    'chat-history-pages-Dwy5WUPH.mjs': '1f14f7dc20c47eee374c969b6fcdcd4792022f46f886d464f85712f5828ad787',
    'chat-history-budget-D3ZekwOg.mjs': '6a3e9feae7585ac2073b6cea90887e1b5424832c0eb783453dbb17e8496a92ee',
    'chat-history-page-kernel-DgKDawOP.mjs': '47db7129126079996ef8feb91e4d57b89128ddc73bcd4bb89d17cd8a0bfe25ff',
    'session-transcript-readers-B2XS9yB_.mjs': '48f47045abbfdc1a2bd4d337f1410a73cc40979165954f5b589f7dd93852f364',
    'transcript-image-artifacts-DqNH9hLC.mjs': '1cdb769c21fa0a2c311d7c87ccbaa9ce6c9b159a9dd53616899e91f9c2e02387',
    'session-accessor.sqlite-transcript-watermark-D3Is2Kik.mjs': '3b4c044c1b3ccb4995dbb1aa9645c424dceb316e4229451a930e41b9768d0dfa',
    'session-accessor.sqlite-transcript-watermark-read-CRApP3Oa.mjs': '9adc8d78827aecadb6d1812bd2892084b4add5a995440839beb9874a83ca962c',
    'session-cold-storage-state-CzcE3h3O.mjs': 'c06a30da9441c3c3a45cb75943d29815363f878b3f693d58b7468594d924423a',
    'openclaw-agent-db-readonly-C4wDuLrp.mjs': '2e87c1bdb54c1f44b9c3091e8e9041aefea22beac2beade2bb3d68db60be6f18',
    'openclaw-agent-db-readonly-open-hQ4ohjUT.mjs': '80cfdea95c30e5f49c86e7e095ec5c3525a76e6377a0f085aa725299b5972f6a',
    'openclaw-agent-db-readonly-scope-CLlkTUQB.mjs': '2494db540f1aa005c807d1aa07b755b8bb7622c7b50910646283454cadc9e81c',
    'session-history-worker-runtime-BYfPFv26.mjs': '280c70d8652a80a844ea30f9a51edb7c3328aaf849b5d691bc4683cbad7597ae',
    // Archive calls omit the private-human action-link flag and retain
    // ignoreCliSessionImports. Only audited worker bytes are admitted.
    'session-history-worker-runtime-BRYuXSiH.mjs': ['dcb16d5367d76eb58480dfef00e3c26819a2d1e4cb7099c92e455815997ba41a',
      'eddb927a33e7f8f6b49555376557717967617d7c57d38582e92f14aa762ed8d0'],
    'runtime-process-entrypoints-Dgz2IR4T.mjs': 'e461997c003d9dffc750471f288ef7bc442c54666f40fc38545b9323367f3c87',
    'plugin-sdk/session-store-runtime.js': '22c872309a66d7dba3f0c84e0f91e95c0c8878c89938e67af94e4059b43cc0ff',
    'session-store-runtime-DSst5RB7.mjs': '2a7619b47f9ece4b1d7378f9ce787ca8b0dece85e8edbc2625ee5c4a6e342394',
    'session-accessor.sqlite-entry-Dn_MsDKD.mjs': '7d43372908d92db156dfadf6a3b105ef5d9180d95907a9639747b65a440eb01a',
  }, entrypoints: ['runtime-process-entrypoints-Dgz2IR4T.mjs', 'n'], bindings: {
    chat: {
      i: ['chat-history-pages-Dwy5WUPH.mjs', 't'],
      r: ['chat-history-page-kernel-DgKDawOP.mjs', 'n'],
      c: ['chat-history-budget-D3ZekwOg.mjs', 's'],
      a: ['chat-history-page-kernel-DgKDawOP.mjs', 'i'],
    },
    readers: ['session-transcript-readers-B2XS9yB_.mjs', '_'],
    display: ['transcript-image-artifacts-DqNH9hLC.mjs', 'i'],
    accessor: ['session-accessor.sqlite-transcript-watermark-D3Is2Kik.mjs', 't'],
  } },
  '2026.10.5': { pins: {
    // 10.5 owns cursor calculation inside canonical response preparation.
    // Use that exported pipeline, not a reconstructed private cursor function.
    // Read-only authority now includes split current-entry/cache owners and
    // retained cold-archive watermarks. Other variants still fail closed.
    'chat-history-pages-DPfzrnwK.mjs': '1e5cf1d18ffa3d01ab0067f3aa604d1632cb7692cd698478a7ddb58350daff8e',
    'chat-history-response-page-D73oDDMx.mjs': '16834db2a856d4d3af1bb4788388b647e9e7c0967db23e618fa9562a54b7834c',
    'chat-history-page-kernel-BitjIRbG.mjs': 'd8215716abc148d5eee27e637b818cc600e3787562906fbd14c557393f6ac559',
    'chat-history-reply-messages-D-PxjbT8.mjs': 'cc63f10688394d9fb604147f32da7f45cf59007fd82dd3d0bcc44609fef83073',
    'session-transcript-readers-qSQG9un6.mjs': 'ebb91f8ca4eb2c00f75300aa40e90076eaac2dd85198c8ddab7309b0a817649c',
    'transcript-image-artifacts-BNfLH5hX.mjs': 'c178ec43dd57b075cfcaf3e68e4d7adc801eeee92383fdc8fac567310a821aca',
    'session-accessor.sqlite-transcript-watermark-D9UJ7GKl.mjs': 'adb34c1b59f12c4a2c8b58661cc650d8d132907461982bdc5d97fe7f2982054c',
    'session-accessor.sqlite-transcript-watermark-read-RzaBbh24.mjs': 'e09139f071fb861461b87a687d19aa4a5eacb1aa60b650fd98280df700d56a92',
    'session-cold-storage-state-i63ewDM3.mjs': '531d009331a30c4e4bb9b12c175bb699e8945dd3c5e38783f2c9f8327b85f74d',
    'openclaw-agent-db-readonly-BeNrd8ZK.mjs': 'a9d3e64f6e735d1e7d6b38b77d7e5475930fb5a0dd5bd0a830ebbf762cd94b51',
    'openclaw-agent-db-readonly-open-IWNL_J3y.mjs': 'fb6f9c73843a2ad7d7e3052d8cd83b0bc45daf751f320d86444576d1b3414d6e',
    'openclaw-agent-db-readonly-scope-C8Pf8klQ.mjs': 'f1202bcbdc578b63d3a2c1c81ffce0b5d4c9869d56d26880c4c205c8bfd1a6a3',
    'session-history-worker-runtime-DrQDqmST.mjs': '6254b860f937741439ac5fa6e409f9ca8692e522d4ae3df0d4178e2284b1ab7e',
    // Stock or independently reproduced private-human action-link forwarding.
    'session-history-worker-runtime-DN5YzP8P.mjs': ['9ca68ff8223b54c7f5ca206a2ab36906051abfb10ed9bbd8a0d444b4605b8ea2',
      '546e69b47d5ad5097237cd682eefe5f92c4eb7894a76854522498a12f08b363b'],
    'runtime-process-entrypoints-De68tE_W.mjs': '0bb4e3da0d954df9053093e62f3f909389e2e85fb673bbae2865523caf936763',
    'plugin-sdk/session-store-runtime.js': '23c746db2ac16b18fd6ed948850e3ee054a3e67a60c9b3a8344a19050552c1d1',
    'session-store-runtime-CSdv6gv9.mjs': 'a0cfd65af25cfe744098304bbc1525c71cc8330beaddb0d259835a2f187709c0',
    'session-store-runtime-internal-0S172J_J.mjs': '5da8c6db376443d5a3a381afb53d043a8dec8cd250bd3685d2a2462fdb3f2d37',
    'session-accessor.sqlite-entry-DLM4ONjh.mjs': '18219458b16eb1f9e03eb5ed47755be1f9fe992fdb75db78ff2a729c94ce9ef6',
    'session-accessor.sqlite-entry-read-B0IgUWcj.mjs': '7468a404797e3a41911ba320bd4fa2b4d4cd3c4e35841facb26b69b670332a38',
    'session-accessor.sqlite-entry-identity-q6rrrQxU.mjs': 'e48774b6ae6bce6a608fe6c25c5327e8dbff6f582fd0a7a85407fc66d8ba24cb',
    'session-accessor.sqlite-entry-list.read-DIl3XT7a.mjs': 'a1b75be13480bb9360ffb684f0ee536c66afbdefec02946275b7cfaa722b2cb5',
  }, entrypoints: ['runtime-process-entrypoints-De68tE_W.mjs', 'n'], bindings: {
    chat: {
      i: ['chat-history-pages-DPfzrnwK.mjs', 'n'],
      r: ['chat-history-response-page-D73oDDMx.mjs', 'n'],
      c: ['chat-history-response-page-D73oDDMx.mjs', 'u'],
    },
    preparePage: ['chat-history-response-page-D73oDDMx.mjs', 'r'],
    readers: ['session-transcript-readers-qSQG9un6.mjs', '_'],
    display: ['transcript-image-artifacts-BNfLH5hX.mjs', 'i'],
    accessor: ['session-accessor.sqlite-transcript-watermark-D9UJ7GKl.mjs', 't'],
  } },
  // Exact stock and independently composed 10.6 owners. Activation is separate.
  '2026.10.6': { pins: {
    'chat-history-pages-_X-Upbh7.mjs': 'fb061561c856f7d8921fc2819177ac966e2151d06a349a0a7286e10f62655ad0',
    'chat-history-response-page-BV1qCke4.mjs': '5848f4fb956a128184e006e6bd1c4b4a519a133ba8f4aafda8dc958fbd8e1c13',
    'chat-history-page-kernel-yHH7K0Mo.mjs': 'd8393834714a8222a35df701a59edb02c52bcd20a4f398d00c53dc5d14825c14',
    'chat-history-reply-messages-OLz_LDJu.mjs': '98988a28b7e07ca7784f3fe87872ef210f7689da83428a18cbf9e91ec2ba5808',
    'session-transcript-readers-H4qxPb0s.mjs': '53bbfaa4f1bf4dcbe614e4cba0c97590cf4a9b0d51d2aa1ec70cc70c4242be90',
    'transcript-image-artifacts-BNfLH5hX.mjs': 'c178ec43dd57b075cfcaf3e68e4d7adc801eeee92383fdc8fac567310a821aca',
    'session-accessor.sqlite-transcript-watermark-BFGVDoNH.mjs': '4b40a0334d1028a2d6ca7fe37d0cd6e0f4fd151a9078f81d32484eaf2f95dd13',
    'session-accessor.sqlite-transcript-watermark-read-pM49eygF.mjs': '8e83632b82d247f09cf8c97d72f5b9dea32b76d0ad6c1c078f2e5ded3f8753b7',
    'session-cold-storage-state-Du4uWUqB.mjs': 'ff0567c5fc8ed391b49f506d480f10baae101d556bde162724f9762094c049ce',
    'openclaw-agent-db-readonly-Cs19n1vw.mjs': '3b7f38b84cfe0f84f165747feabed62dd964b868dc270a8fb9ce5cb6fc99ec18',
    'openclaw-agent-db-readonly-open-BCj4NoY3.mjs': '4c9b38c16cefdf353866b5f5dbb48eecb749c1310ae8f000a7aa7d9ad5a7d43e',
    'openclaw-agent-db-readonly-scope-Cji1qVy-.mjs': '270b986d77f9ab4057ee879ab985123293bc74cc65be523e522a4bd239cab8a1',
    'session-history-worker-runtime-72hKKwqF.mjs': 'c9ce231fee3537a1e9fdf4ba5a5ad4b5c9b5fe3e3bbc0fe8f159a62bdc002ef6',
    'session-history-worker-runtime-LGQ7fiuR.mjs': ['95d9631957f3afd7942cfd18c6c1a8d354db0c7bf37c7027b8c62b70b12f45ca', '7546ce516003cd79f324aaae538d622245a7fdc9320e36151b5c3408485b3554'],
    'runtime-process-entrypoints-De68tE_W.mjs': '0bb4e3da0d954df9053093e62f3f909389e2e85fb673bbae2865523caf936763',
    'plugin-sdk/session-store-runtime.js': '2dd0ef3cb9699af1032c4a952a4e6710d1c661a0e198768b86f8fea8d97250d9',
    'session-store-runtime-BYYFG9yb.mjs': 'a4854b0c28fc5e1e5ef191a1e70e700a19c35cf0ec1c6424fd71c4275ff396f2',
    'session-store-runtime-internal-BlsPKGen.mjs': '5ed0be590d86a5797c0013588bf7eda6432de4f71b37df8a69d27873b92a0a90',
    'session-accessor.sqlite-entry-3j_or22H.mjs': 'a264a3d04ee8e1bc013069ec4242080a551a116c9a7eb316ce0ecb249cbf72dd',
    'session-accessor.sqlite-entry-read-CIilkUET.mjs': '51f65b8bb5913598bc2d3752bf598e23049dda7cdc54b1db7d0d61355f438186',
    'session-accessor.sqlite-entry-identity-CtkWDst1.mjs': 'af45db67443f5b97e19257431e8ab538fc91372741648dc5ac03d04edf265bfa',
    'session-accessor.sqlite-entry-list.read-B7GHFRZs.mjs': 'a5aa98c295a251d1624be7bed2376f28cad929d1045bfc52f049ec9be71508e7',
  }, entrypoints: ['runtime-process-entrypoints-De68tE_W.mjs', 'n'], bindings: {
    chat: { i: ['chat-history-pages-_X-Upbh7.mjs', 'n'], r: ['chat-history-response-page-BV1qCke4.mjs', 'n'], c: ['chat-history-response-page-BV1qCke4.mjs', 'u'] },
    preparePage: ['chat-history-response-page-BV1qCke4.mjs', 'r'],
    readers: ['session-transcript-readers-H4qxPb0s.mjs', '_'],
    display: ['transcript-image-artifacts-BNfLH5hX.mjs', 'i'],
    accessor: ['session-accessor.sqlite-transcript-watermark-BFGVDoNH.mjs', 't'],
  } },
};
