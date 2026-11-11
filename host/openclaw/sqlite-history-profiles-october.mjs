// Audited October reader fingerprints. Keep unknown runtime bytes fail-closed.
export const OCTOBER_PROFILES = {
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
  // Audited 10.7 native reader identities. Keep historical release profiles.
  '2026.10.7': { pins: {
    'chat-history-pages-CHtAXEWj.mjs': 'd29872fc18f9cabbef392decbdc83d5c1637d5ec1c6603d9c716eb261cecc4a0',
    'chat-history-response-page-MWKhnMXQ.mjs': '92f9d757b2b70020c111d5e33619c2612ea832b102074f63cc546f948235d325',
    'chat-history-page-kernel-DM4xbPS6.mjs': '6c7cd1af55a20959d4ca68cb37abbcfef00f7bd5dcb1be69f937ec70915644e5',
    'chat-history-reply-messages-BZOuEBeD.mjs': 'f408516b77c1f7ca61dbd77cff43d1a7a59285a770692efa046d44c4a9aa676c',
    'session-transcript-readers-BV8JRtb4.mjs': '6f7c598da5dff9c71fdf7f4558234f8f980c50fba750e854489912caf90acc84',
    'transcript-image-artifacts-BNfLH5hX.mjs': 'c178ec43dd57b075cfcaf3e68e4d7adc801eeee92383fdc8fac567310a821aca',
    'session-accessor.sqlite-transcript-watermark-D555jPu4.mjs': '5d819df004175267da741cf619d0b93bd8e4f3f2202c9c60e5a2d63c80586520',
    'session-accessor.sqlite-transcript-watermark-read-pM49eygF.mjs': '8e83632b82d247f09cf8c97d72f5b9dea32b76d0ad6c1c078f2e5ded3f8753b7',
    'session-cold-storage-state-Du4uWUqB.mjs': 'ff0567c5fc8ed391b49f506d480f10baae101d556bde162724f9762094c049ce',
    'openclaw-agent-db-readonly-D_snMxnt.mjs': '751cec65ccbf8a619ccda6a83925569f4cdbac7a2328e583d6a435b21b708684',
    'openclaw-agent-db-readonly-open-BstClAiL.mjs': 'ab08f6bfd724e2063f4f7523f600c60d35397ddf246f9519731d187ae25951b8',
    'openclaw-agent-db-readonly-scope-CMDz_fd8.mjs': '94518cf89d080f03489ea6ef5ecd1c236f97e47587c21cac00fe1aed88ceaf4d',
    'session-history-worker-runtime-BYqXngLI.mjs': 'c65fcf58692ab14859f4cc24255d6f7e47086a910876c2adbcc0b475c9c932ed',
    'session-history-worker-runtime-Cp9yPM0R.mjs': ['8fb9646e0a6b34be64cc16f39603da73e76bc99e35d9d54bd878ceb4f1d1b550',
      'fe3ff71dbccb658697b5144a1ddee6132d9473c803c56c26236372fde2d39601'],
    'runtime-process-entrypoints-De68tE_W.mjs': '0bb4e3da0d954df9053093e62f3f909389e2e85fb673bbae2865523caf936763',
    'plugin-sdk/session-store-runtime.js': '4a6dabdbad6a550e8c230e8bd2c8a39054031fdd37ad4bb76a116694a132e68d',
    'session-store-runtime-BkFZ8NdT.mjs': '9c8f975a92fa3d4fb330c1042555125676bd289cda1a83ce9d8aad2adee46d77',
    'session-store-runtime-internal-nJ868Tnu.mjs': '745e6701bd8daece112ea546586fe728a2d14fc8878b10371cbc75a812b7172f',
    'session-accessor.sqlite-entry-DvEiQ1z_.mjs': '4f4057e761f3d2a9ea13fb1a3dbb4d1fa2048f1c3871ed1822d1c7f0d7205976',
    'session-accessor.sqlite-entry-read-baVe0TzU.mjs': 'd3a3c18cb1375667aa6fabe3a4d2f864e65d2645803eda3c87871de10b2f5881',
    'session-accessor.sqlite-entry-identity-DrdPvFmY.mjs': 'be09a2279c28114f0460cc8a290c1426213bf6d7b775f35f4a7bdd134f4d9854',
    'session-accessor.sqlite-entry-list.read-BOOxnkSW.mjs': '3701456cfff0722d41d64b4cacbb86fcbab5a4fa0d2129a3eca7f2dbd3a947e0',
  }, entrypoints: ['runtime-process-entrypoints-De68tE_W.mjs', 'n'], bindings: {
    chat: { i: ['chat-history-pages-CHtAXEWj.mjs', 'n'], r: ['chat-history-response-page-MWKhnMXQ.mjs', 'n'], c: ['chat-history-response-page-MWKhnMXQ.mjs', 'u'] },
    preparePage: ['chat-history-response-page-MWKhnMXQ.mjs', 'r'],
    readers: ['session-transcript-readers-BV8JRtb4.mjs', '_'],
    display: ['transcript-image-artifacts-BNfLH5hX.mjs', 'i'],
    accessor: ['session-accessor.sqlite-transcript-watermark-D555jPu4.mjs', 't'],
  } },
  // Audited 10.8 native exports and read-only ownership, with 10.7 retained.
  '2026.10.8': { pins: {
    'chat-history-pages-Dht38VPb.mjs': '61f3250c0f0cc986fbe6ca13be485fb8d1dbfbf5058af5defd07f3db30e37245',
    'chat-history-response-page-DjVKpY65.mjs': 'cf5e13aca7d301f15c1d8cc14c9d771f4c5a48d48d449bec3467f9ed4e885c19',
    'chat-history-page-kernel-CPU7-UvR.mjs': '1deaab049dcabe497735f48a164b7861d599eeeb75eeb6368e7ebffd5c63f295',
    'chat-history-reply-messages-KYD5oh59.mjs': '54bc1013f34ccd41add85b385f23722f48c10adffb0e7be3086e0dcd851a7be9',
    'session-transcript-readers-0AmpbL8T.mjs': '9e8cac9768bb51e663f791099f0856a080e7dca58acf863ddc9fd03a4d163fa1',
    'transcript-image-artifacts-BNfLH5hX.mjs': 'c178ec43dd57b075cfcaf3e68e4d7adc801eeee92383fdc8fac567310a821aca',
    'session-accessor.sqlite-transcript-watermark-DmNjcFam.mjs': '41991bc3b19bb911899f02d67e362ca51f20693b654a3feb2b889e13db893864',
    'session-accessor.sqlite-transcript-watermark-read-D2nLMbB0.mjs': 'ecd6b5a19c48b963acc73228790b584b3a3390602e2211c763629b449d262e00',
    'session-cold-storage-state-BRw-PqQq.mjs': '4a28d189d1d3a149d161a472a32a8590f858231b38c3b0286dacd9adea06e803',
    'openclaw-agent-db-readonly-BfnWcaW1.mjs': '8fc799af91ce5e1b93bf4098f1544aaa4d065e55df98a3928cb7477dfca8351f',
    'openclaw-agent-db-readonly-open-D87nMHnQ.mjs': '2920d77152baa23e56ea14f4015c73634ccc1e4955a5535433d7fe8beb64a262',
    'openclaw-agent-db-readonly-scope-B0XmWwc2.mjs': '6e08e86dfb71ac21bfd251267fa055664ae6e3e2f6cdb9beeac5da4333dada6d',
    'session-history-worker-runtime-CVX1dOzq.mjs': 'a0f26604e5e29a0cfd800cd4b616380410ebe1afc48d7fdf3f46200ca72bd351',
    'session-history-worker-runtime-ONplUnTA.mjs': ['758633c93aaca7222c2bc1940e406474f960f943b6400d1b013444098c23fbb3', '920d7fe07b088820b6c24de3746c4c913799b5170ff985c72e02a29efcce6278'],
    'runtime-process-entrypoints-De68tE_W.mjs': '0bb4e3da0d954df9053093e62f3f909389e2e85fb673bbae2865523caf936763',
    'plugin-sdk/session-store-runtime.js': '1a9dd85feaf51eb964235d9c97f5b1d0bfabdbc733c83bfde5efdfb1f55bda8e',
    'session-store-runtime-DSUdEGMQ.mjs': '3b1082586f0bb33bf6ae763305c810e8d6f9f3bbf5e4c8d6fda7dd354a194b14',
    'session-store-runtime-internal-D5kNYmPh.mjs': '35545a16168beca93fc832446c0891b435aba5b7903126aa21676fc8841a5349',
    'session-accessor.sqlite-entry-CNVNWegb.mjs': 'c24e98b5eeb7056f9a9e5312abc524f016b58ea39e5bc5fc18bbafdfbca51b18',
    'session-accessor.sqlite-entry-read-CNqQF5P1.mjs': 'a234a8daa05f24a322c1a5d2a709d24d9d131a2ab50e8d8ef620d6dc4bcf863a',
    'session-accessor.sqlite-entry-identity-DGsKHJQ8.mjs': '41c07f981235e93ee7baf24c8326b052154a5b18df50fb5324a601d3ef6e56ac',
    'session-accessor.sqlite-entry-list.read-BW7Nrq0y.mjs': '25bee37ec43a0309bb74990dadea07ae030e36147b872338c0a1e9248d170bf9',
  }, entrypoints: ['runtime-process-entrypoints-De68tE_W.mjs', 'n'], bindings: {
    chat: { i: ['chat-history-pages-Dht38VPb.mjs', 'n'], r: ['chat-history-response-page-DjVKpY65.mjs', 'n'], c: ['chat-history-response-page-DjVKpY65.mjs', 'u'] },
    preparePage: ['chat-history-response-page-DjVKpY65.mjs', 'r'],
    readers: ['session-transcript-readers-0AmpbL8T.mjs', '_'],
    display: ['transcript-image-artifacts-BNfLH5hX.mjs', 'i'],
    accessor: ['session-accessor.sqlite-transcript-watermark-DmNjcFam.mjs', 't'],
  } },
  // Candidate exact 10.10 native read owners. Activation requires final-composition acceptance.
  '2026.10.10': {
  "pins": {
    "chat-history-pages-BScIpCdt.mjs": "a2513fe31c18058e80fdb0c902a42dd1732522edd834b9a1e4c35d3011a1d516",
    "chat-history-response-page-wiRB1dhs.mjs": "c26358129fc0bc529cdbdd40eec844f0a09e9f479f18b9bf0638998ca704984c",
    "chat-history-page-kernel-DBx9sKmm.mjs": "cf0cc0a5c9793c2f30257d0232e014f6c3fa54f55a6d342c5cf6cd01ada3a445",
    "chat-history-reply-messages-BAONaKKD.mjs": "941d5c466dd56fe60291b13881fc47bb80bc33941ca1659697b6e81115895c8c",
    "session-transcript-readers-C6_dZAYs.mjs": "fecb20e8187e5a31bfff5cb02c873bdca648b492668579a5c4fd8c9023d871b4",
    "transcript-image-artifacts-BNfLH5hX.mjs": "c178ec43dd57b075cfcaf3e68e4d7adc801eeee92383fdc8fac567310a821aca",
    "session-accessor.sqlite-transcript-watermark-CJ36yRM5.mjs": "a03b21a626185802cea7b875ddc4d9845663d773ce07c7a16eaeafdcfcd74693",
    "session-accessor.sqlite-transcript-watermark-read-CnMvH9TP.mjs": "c15dcae5dfbbcfff66ffdbf3d9268c1194add77f66ef8436a4f66cee736bc9e8",
    "session-cold-storage-state-1DAx8e8T.mjs": "401a6bf7b175b4f74e7443795ad32142bbf1ee0cf2d55ff93d56a16da1846c76",
    "openclaw-agent-db-readonly--_5tZY-q.mjs": "ba87c89a4df961777d2f46d43169aa3863fec957ecbbb0fb1af11a0b4e8e9ffa",
    "openclaw-agent-db-readonly-open-CYbllL3H.mjs": "869503224fdb36195c893163f21cc88effd7e9f32d6ca13965892425f3f73b28",
    "openclaw-agent-db-readonly-scope-BbWVQpo-.mjs": "001f19d0e0ee0b7d44ce14d6db54fb64f8c65c4e4df9351f7af0caee31194a75",
    "session-history-worker-runtime-DuuMxhbu.mjs": "ce0e388ba074ba8c0d61211f46f7b71e8e6bbffe186e55c64ccc31169a2c50f3",
    "session-history-worker-runtime-BXn7k8bN.mjs": "dceaf58447747392864f8e2e3df8692ba789f6fe699049a3c4d00b532d446369",
    "runtime-process-entrypoints-BMmG9cQl.mjs": "c06ba843e61d4e0b36949760674ade773ace200d8c1553529fadc0511fa111b4",
    "plugin-sdk/session-store-runtime.js": "ae77e640df2d4590e2bd1aca5647abdc05a7a0678112ec16428cf8d4e3962fd6",
    "session-store-runtime-DrlYbn_f.mjs": "0e0a6e3ec317af426c727ba297f2d7004c802c8771627cc85782b654607bd5bd",
    "session-store-runtime-internal-CPqEU1AY.mjs": "dcee073b7c55e6426acddbfb1ce2187fd17d961679aff62072d5b34be9a0783c",
    "session-accessor.sqlite-entry-DpCsEkJi.mjs": "cfcb10c0d063fd5460716f8bf1a8c74b6ee5641f9b1a93e15fe89b8f08590838",
    "session-accessor.sqlite-entry-read-B-fKxDgi.mjs": "1be44be5909c6715eeb591ebe37ce01c2c72b2f9109ca885ff6ff5590c25c522",
    "session-accessor.sqlite-entry-identity-DquS7oyh.mjs": "48499a6e3bd69c32fb2b2e902bbb4b208f2111f013d5250db5455732cd7fecd2",
    "session-accessor.sqlite-entry-list.read-CYVbMhpt.mjs": "13c7921ea66ccfc9ef54edef8062af6456630cdc53e736f48ef82d52f154017b",
    "session-utils.fs-BTKkUYd7.mjs": "737ec6ec02a2b1333a1ed03eceed7456653d7fd48423b4f3885da88323c42027",
    "chat-history-budget-DMTS7TVJ.mjs": "71cb679750ac480c990dd04a56983cf7568b668b942ef990988fdebf57ca1be7",
    "cli-session-history-D6nBBvut.mjs": ["c6b6cce4a47d937270619e8c677959ffe710f793618ed96cffb09acc9edb140c",
      "f06a3504f51867e90f98a62c6db3e8608c44f8c264ff47d0b8f27263fcb31dc7"]
  },
  "entrypoints": [
    "runtime-process-entrypoints-BMmG9cQl.mjs",
    "n"
  ],
  "bindings": {
    "chat": {
      "i": [
        "chat-history-pages-BScIpCdt.mjs",
        "n"
      ],
      "r": [
        "chat-history-response-page-wiRB1dhs.mjs",
        "n"
      ],
      "c": [
        "chat-history-budget-DMTS7TVJ.mjs",
        "c"
      ]
    },
    "preparePage": [
      "chat-history-response-page-wiRB1dhs.mjs",
      "r"
    ],
    "readers": [
      "session-utils.fs-BTKkUYd7.mjs",
      "t"
    ],
    "display": [
      "transcript-image-artifacts-BNfLH5hX.mjs",
      "i"
    ],
    "accessor": [
      "session-accessor.sqlite-transcript-watermark-CJ36yRM5.mjs",
      "t"
    ]
  }
},
};
