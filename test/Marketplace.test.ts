import { loadFixture, time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { ethers } from "hardhat";

async function deployNFTMarketplaceFixture() {
  const [owner, USER1, USER2, USER3] = await ethers.getSigners();
  const MarketplaceFactory = await ethers.getContractFactory("Marketplace");
  const Marketplace = await MarketplaceFactory.deploy("My NFT Marketplace");

  return { Marketplace, owner, USER1, USER2, USER3 };
}

async function deployFixture1() {
  const { Marketplace, owner, USER1, USER2, USER3 } =
    await deployNFTMarketplaceFixture();

  const NFTCollectionFactory = await ethers.getContractFactory("NFTCollection");
  const NFTCollection = await NFTCollectionFactory.deploy();

  const PaymentTokenFactory = await ethers.getContractFactory("ERC20Mock");
  const PaymentToken = await PaymentTokenFactory.deploy(
    1000000,
    "Test Token",
    "XTS"
  );
  await NFTCollection.connect(USER3).mintNFT("Test NFT", "test.uri.domain.io");
  await Marketplace.addAcceptedNFTCollection(NFTCollection.address);
  await Marketplace.addPaymentToken(PaymentToken.address);
  const result1 = await Marketplace.paymentTokens(await PaymentToken.address);
  await expect(result1).to.be.equal(ethers.BigNumber.from("1"));
  const result2 = await Marketplace.acceptedNFTCollection(await NFTCollection.address);
  await expect(result2).to.be.equal(ethers.BigNumber.from("1"));
  return { Marketplace, NFTCollection, PaymentToken, owner, USER1, USER2, USER3 };
}
async function deployFixture2() {
  const { Marketplace, NFTCollection, PaymentToken, owner, USER1, USER2, USER3 } =
    await deployFixture1();

  // Approve NFT transfer by the marketplace
  await NFTCollection.connect(USER3).approve(Marketplace.address, 0);
  let auctionPeriod = 3600;
  await Marketplace.connect(USER3).createAuction(
    NFTCollection.address,
    PaymentToken.address,
    0,
    50,
    100,
    auctionPeriod
  );
  return { Marketplace, NFTCollection, PaymentToken, owner, USER1, USER2, USER3 };
}

async function deployFixture3() {
  const { Marketplace, NFTCollection, PaymentToken, owner, USER1, USER2, USER3 } =
    await deployFixture2();

  await PaymentToken.connect(USER1).approve(Marketplace.address, 10000);
  // credit USER1 balance with tokens
  await PaymentToken.transfer(USER1.address, 10000);
  // Place new bid with USER1
  await Marketplace.connect(USER1).bid(0, 500);

  return { Marketplace, NFTCollection, PaymentToken, owner, USER1, USER2, USER3 };
}

async function claimFunctionSetUp(bider: any, Auctiontime: any) {
  const { Marketplace, USER1, USER2, USER3 } = await deployNFTMarketplaceFixture();
  const NFTCollectionFactory = await ethers.getContractFactory("NFTCollection");
  const NFTCollection = await NFTCollectionFactory.deploy();

  const PaymentTokenFactory = await ethers.getContractFactory("ERC20Mock");
  const PaymentToken = await PaymentTokenFactory.deploy(1000000, "Test Token", "XTS");

  await NFTCollection.connect(USER1).mintNFT("Test NFT", "test.uri.domain.io");
  await NFTCollection.connect(USER1).approve(Marketplace.address, 0);

  await Marketplace.addAcceptedNFTCollection(NFTCollection.address);
  await Marketplace.addPaymentToken(PaymentToken.address);

  const currentTimestamp = await time.latest();
  await Marketplace.connect(USER1).createAuction(NFTCollection.address, PaymentToken.address, 0, 50,100, Auctiontime);
  if (bider) {
    // allow marketplace contract to get token
    await PaymentToken.connect(USER2).approve(Marketplace.address, 10000);
    // credit USER2 balance with tokens
    await PaymentToken.transfer(USER2.address, 20000);
    // place new bid
    await Marketplace.connect(USER2).bid(0, 500);
  }
  return { Marketplace, NFTCollection, PaymentToken, USER1, USER2, USER3 };
}

describe("Marketplace contract tests", () => {
  describe("Deployment", () => {
    it("Should set the correct name", async () => {
      const { Marketplace } = await loadFixture(
        deployNFTMarketplaceFixture
      );
      expect(await Marketplace.name()).to.equal("My NFT Marketplace");
    });

    it("Should intialize auction sequence to 0", async () => {
      const { Marketplace } = await loadFixture(
        deployNFTMarketplaceFixture
      );

      expect(await Marketplace.index()).to.equal(0);
    });

    it("Payment Token should be ERC20 token", async () => {
      const { Marketplace, USER1 } = await loadFixture(
        deployNFTMarketplaceFixture
      );
      await Marketplace.addPaymentToken(await USER1.address);
      const result1 = await Marketplace.paymentTokens(await USER1.address);
      await expect(result1).to.be.equal(ethers.BigNumber.from("0"));
    });
    it("Only marketplace owner add payment tokens", async () => {
      const { Marketplace, USER1 } = await loadFixture(
        deployNFTMarketplaceFixture
      );
      await expect(Marketplace.connect(USER1).addPaymentToken(await USER1.address)).to.be.revertedWith("Ownable: caller is not the owner"); 
      await expect(Marketplace.connect(USER1).removePaymentToken(await USER1.address)).to.be.revertedWith("Ownable: caller is not the owner"); 
    });

    it("NFT should be ERC721 token", async () => {
      const { Marketplace, USER1 } = await loadFixture(
        deployNFTMarketplaceFixture
      );
      await expect(Marketplace.connect(USER1).addAcceptedNFTCollection(await USER1.address)).to.be.revertedWith("Ownable: caller is not the owner"); 
      await expect(Marketplace.connect(USER1).removeAcceptedNFTCollection(await USER1.address)).to.be.revertedWith("Ownable: caller is not the owner");
      await Marketplace.addAcceptedNFTCollection(await USER1.address);
      const result1 = await Marketplace.acceptedNFTCollection(await USER1.address);
      
      await expect(result1).to.be.equal(ethers.BigNumber.from("0")); 
    });
  });

  describe("Transactions - Create Auction", () => {
    describe("Create Auction - Failure", () => {
      let endAuction = Math.floor(Date.now() / 1000) + 10000;

      it("Should reject Auction because the NFT collection contract address is invalid", async () => {
        const { Marketplace, PaymentToken, USER1 } = await loadFixture(
          deployFixture1
        );

        await expect(
          Marketplace.createAuction(
            USER1.address,
            PaymentToken.address,
            0,
            50,
            100,
            endAuction
          )
        ).to.be.revertedWith("Invalid NFT Collection contract address");
      });

      it("Should reject Auction because the Payment token contract address is invalid", async () => {
        const { Marketplace, NFTCollection, USER1 } = await loadFixture(
          deployFixture1
        );

        await expect(
          Marketplace.createAuction(
            NFTCollection.address,
            USER1.address,
            0,
            50,
            100,
            endAuction
          )
        ).to.be.revertedWith("Invalid Payment Token contract address");
      });

      it("Should reject Auction because the end date of the auction is invalid", async () => {
        let invalidEndAuction = 0;
        const { Marketplace, NFTCollection, PaymentToken } = await loadFixture(
          deployFixture1
        );

        await expect(
          Marketplace.createAuction(
            NFTCollection.address,
            PaymentToken.address,
            0,
            50,
            100,
            invalidEndAuction
          )
        ).to.be.revertedWith("Invalid auction period");
      });

      it("Should reject Auction because the initial bid price is invalid", async () => {
        const { Marketplace, NFTCollection, PaymentToken } = await loadFixture(
          deployFixture1
        );

        await expect(
          Marketplace.createAuction(
            NFTCollection.address,
            PaymentToken.address,
            1,
            0,
            100,
            endAuction
          )
        ).to.be.revertedWith("Invalid initial bid price");
      });

      it("Should reject Auction because caller is not the owner of the NFT", async () => {
        const { Marketplace, NFTCollection, PaymentToken, USER1 } =
          await loadFixture(deployFixture1);

        await expect(
          Marketplace.connect(USER1).createAuction(
            NFTCollection.address,
            PaymentToken.address,
            0,
            50,
            100,
            endAuction
          )
        ).to.be.revertedWith("Caller is not the owner of the NFT");
      });

      it("Should reject Auction because owner of the NFT hasnt approved ownership transfer", async () => {
        const { Marketplace, NFTCollection, PaymentToken, owner, USER1, USER2 ,USER3 } = await loadFixture(
          deployFixture1
        );

        await expect(
          Marketplace.connect(USER3).createAuction(
            NFTCollection.address,
            PaymentToken.address,
            0,
            50,
            100,
            endAuction
          )
        ).to.be.revertedWith("Require NFT ownership transfer approval");
      });
    });

    describe("Create Auction - Success", () => {
      let endAuction = Math.floor(Date.now() / 1000) + 10000;

      it("Check if auction is created", async () => {
        const { Marketplace, NFTCollection, PaymentToken, owner, USER1, USER2 ,USER3 } = await loadFixture(
          deployFixture1
        );
        await NFTCollection.connect(USER3).approve(Marketplace.address, 0);

        await Marketplace.connect(USER3).createAuction(
          NFTCollection.address,
          PaymentToken.address,
          0,
          50,
          100,
          endAuction
        );
      });

      it("Owner of NFT should be the marketplace contract ", async () => {
        const { Marketplace, NFTCollection, PaymentToken, owner, USER1, USER2 ,USER3 } = await loadFixture(
          deployFixture1
        );
        await NFTCollection.connect(USER3).approve(Marketplace.address, 0);
        await Marketplace.connect(USER3).createAuction(
          NFTCollection.address,
          PaymentToken.address,
          0,
          50,
          100,
          endAuction
        );
        const ownerNFT = await NFTCollection.ownerOf(0);
        expect(ownerNFT).to.equal(Marketplace.address);
      });
    });
  });
  describe("Transactions - Place new Bid on auction", () => {
    describe("Place new Bid on an auction - Failure", () => {
      it("Should reject new Bid because the auction index is invalid", async () => {
        const { Marketplace, USER1 } = await loadFixture(deployFixture2);

        await expect(
          Marketplace.connect(USER1).bid(4545, 100)
        ).to.be.revertedWith("Invalid auction index");
      });
      it("Auction is not open", async () => {
        const { Marketplace, USER1 } = await loadFixture(deployFixture2);
        await ethers.provider.send("evm_increaseTime", [3600]);
        await expect(Marketplace.connect(USER1).bid(0, 25)).to.be.revertedWith(
          "Auction is not open"
        );
      });
      it("Should reject new Bid because the new bid amount is invalid", async () => {
        const { Marketplace, USER1 } = await loadFixture(deployFixture2);
        await expect(Marketplace.connect(USER1).bid(0, 25)).to.be.revertedWith(
          "New bid price must be higher than the current bid"
        );
      });

      it("Should reject new Bid because caller is the creator of the auction", async () => {
        const { Marketplace,USER3 } = await loadFixture(deployFixture2);
        await expect(Marketplace.connect(USER3).bid(0, 60)).to.be.revertedWith(
          "Creator of the auction cannot place new bid"
        );
      });

      it("Should reject new Bid because marketplace contract has no approval for token transfer", async () => {
        const { Marketplace, USER1 } = await loadFixture(deployFixture2);
        await expect(Marketplace.connect(USER1).bid(0, 60)).to.be.revertedWith(
          "ERC20: insufficient allowance"
        );
      });

      it("Should reject new Bid because new bider has not enought balances", async () => {
        const { Marketplace, PaymentToken, USER1 } = await loadFixture(
          deployFixture2
        );

        await PaymentToken.connect(USER1).approve(Marketplace.address, 10000);

        await expect(Marketplace.connect(USER1).bid(0, 60)).to.be.reverted;
      });
    });

    describe("Place new Bid on an auction - Success", () => {
      it("Token balance of new bider must be debited with the bid amount", async () => {
        const { PaymentToken, USER1 } = await loadFixture(deployFixture3);
        let USER1Bal = await PaymentToken.balanceOf(USER1.address);
        expect(USER1Bal).to.equal(9900);
      });

      it("Token balance of Marketplace contract must be updated with new bid amount", async () => {
        const { Marketplace, PaymentToken, USER3 } = await loadFixture(deployFixture3);
        const marketplaceBal = await PaymentToken.balanceOf(USER3.address);
        expect(marketplaceBal).to.equal(100);
      });

      it("Current bid owner must be refunded after a new successful bid is placed", async () => {
        const { Marketplace, PaymentToken, USER1, USER2, USER3 } = await loadFixture(
          deployFixture3
        );
        // Allow marketplace contract to tranfer token of USER2

        await PaymentToken.connect(USER2).approve(Marketplace.address, 20000);
        // Credit USER2 balance with some tokens
        await PaymentToken.transfer(USER2.address, 20000);
        // Place new bid with USER2
        await expect(Marketplace.connect(USER2).bid(0, 1000)).to.be.revertedWith("Auction is liquidated");
      });
    });
  });
  describe("Auction Payment Ether", () => {
    let Marketplace : any;
    let NFTCollection : any;
    let owner: any;
    let USER1: any;
    let USER2: any;
    let USER3: any;
    beforeEach(async () => {
      [owner, USER1, USER2, USER3, USER3] = await ethers.getSigners();
      const MarketplaceFactory = await ethers.getContractFactory("Marketplace");
      Marketplace = await MarketplaceFactory.deploy("My NFT Marketplace");        
      const NFTCollectionFactory = await ethers.getContractFactory("NFTCollection");
      NFTCollection = await NFTCollectionFactory.deploy();

      const PaymentTokenFactory = await ethers.getContractFactory("ERC20Mock");
      const PaymentToken = await PaymentTokenFactory.deploy(
        1000000,
        "Test Token",
        "XTS"
      );
      await NFTCollection.connect(USER3).mintNFT("Test NFT", "test.uri.domain.io");
      await Marketplace.removeAcceptedNFTCollection(NFTCollection.address);
      await Marketplace.addAcceptedNFTCollection(NFTCollection.address);
      await Marketplace.removeAcceptedNFTCollection(NFTCollection.address);
      await Marketplace.addAcceptedNFTCollection(NFTCollection.address);

      await Marketplace.removePaymentToken(PaymentToken.address);
      await Marketplace.addPaymentToken(PaymentToken.address);
      await Marketplace.removePaymentToken(PaymentToken.address);
      // Approve NFT transfer by the marketplace
      await NFTCollection.connect(USER3).approve(Marketplace.address, 0);
      let auctionPeriod = 3600;
     // console.log(endAuction);
      await Marketplace.connect(USER3).createAuction(
        NFTCollection.address,
        "0x0000000000000000000000000000000000000000",
        0,
        50,
        100,
        auctionPeriod
      );
      
    });
    it("Auction with Ether, When Ether and bid amount are bigger than endPrice", async () => {
      const balance1 = await USER2.getBalance();
      const price1 = ethers.utils.parseEther("500");
      await expect(Marketplace.connect(USER2).bid(0, 1000,{value: price1})).to.be.revertedWith("Not enough value");
      const price2 = ethers.utils.parseEther("1100");
      await Marketplace.connect(USER2).bid(0, 1000,{value: price2});
      const balance2 = await USER2.getBalance();
      expect(balance2).to.be.lte(ethers.utils.parseEther("9900"));
      const balance3 = await USER3.getBalance();
      expect(balance3).to.be.gte(ethers.utils.parseEther("10099"));

      const price3 = ethers.utils.parseEther("1500");
      await expect(Marketplace.connect(USER1).bid(0, 1500,{value: price3})).to.be.revertedWith("Auction is liquidated");
      await ethers.provider.send("evm_increaseTime", [5000]);     
      let newOwnerNFT = await NFTCollection.ownerOf(0);
      expect(newOwnerNFT).to.equal(USER2.address);
    });
    it("Auction with Ether, When only Ether amount are bigger than endPrice", async () => {
      const balance1 = await USER2.getBalance();
      const price2 = ethers.utils.parseEther("100");
      await Marketplace.connect(USER2).bid(0, 80,{value: price2});
      const balance2 = await USER2.getBalance();
      expect(balance2).to.be.lte(ethers.utils.parseEther("9820"));
      expect(balance2).to.be.gte(ethers.utils.parseEther("9819"));
      const balance3 = await USER3.getBalance();
      expect(balance3).to.be.gte(ethers.utils.parseEther("10179"));
      expect(balance3).to.be.lte(ethers.utils.parseEther("10181"));
      let newOwnerNFT = await NFTCollection.ownerOf(0);
      expect(newOwnerNFT).to.equal(USER2.address);    
    });
    it("Auction with Ether, When Ether and bid amount are smaller than endPrice", async () => {
      const balance1 = await USER2.getBalance();
      const price2 = ethers.utils.parseEther("80");
      await Marketplace.connect(USER2).bid(0, 80,{value: price2});
      const balance2 = await USER2.getBalance();
      expect(balance2).to.be.lte(ethers.utils.parseEther("9740"));
      expect(balance2).to.be.gte(ethers.utils.parseEther("9739"));
      const balance3 = await USER3.getBalance();
      expect(balance3).to.be.gte(ethers.utils.parseEther("10259"));
      expect(balance3).to.be.lte(ethers.utils.parseEther("10261"));
      let newOwnerNFT = await NFTCollection.ownerOf(0);
      expect(newOwnerNFT).to.equal(USER2.address);    
    });
  });

  describe("Transactions - Refund NFT", () => {
    describe("Refund NFT - Failure", () => {
      it("Should reject because there is already a bider on the auction", async () => {
        const { Marketplace, USER1, USER2, USER3 } = await loadFixture(
          claimFunctionSetUp.bind(null, true, 3600)
        );
        await expect(Marketplace.connect(USER1).refund(4545)).to.be.revertedWith("Invalid auction index");
        await expect(Marketplace.connect(USER1).refund(0)).to.be.revertedWith("Auction is still open");
        // Increase block timestamp
        await time.increase(5000);
        await expect(Marketplace.connect(USER2).refund(0)).to.be.revertedWith(
          "Tokens can be claimed only by the creator of the auction"
        );
        await expect(Marketplace.connect(USER1).refund(0)).to.be.revertedWith(
          "Existing bider for this auction"
        );
      });
    });

    describe("Refund NFT - Success", () => {
      it("Creator of the auction must be again the owner of the NFT", async () => {
        const { Marketplace, NFTCollection, USER1 } = await loadFixture(
          claimFunctionSetUp.bind(null, false, 3600)
        );

        // Increase block timestamp
        await time.increase(5000);

        await Marketplace.connect(USER1).refund(0);

        let newOwnerNFT = await NFTCollection.ownerOf(0);
        expect(newOwnerNFT).to.equal(USER1.address);
      });
    });
  });
  /************************************************* */
  describe("Fixed-Price Sale", () => {
    describe("Create Fixed-Price Sale - Failure", () => {
      it("Should reject Fixed-Price Sale because the NFT collection contract address is invalid", async () => {
        const { Marketplace, PaymentToken, USER1 } = await loadFixture(deployFixture1);
  
        await expect(
          Marketplace.createFixedPriceSale(
            USER1.address,
            PaymentToken.address,
            0,
            50
          )
        ).to.be.revertedWith("Invalid NFT Collection contract address");
      });
  
      it("Should reject Fixed-Price Sale because the Payment token contract address is invalid", async () => {
        const { Marketplace, NFTCollection, USER1 } = await loadFixture(deployFixture1);
  
        await expect(
          Marketplace.createFixedPriceSale(
            NFTCollection.address,
            USER1.address,
            0,
            50
          )
        ).to.be.revertedWith("Invalid Payment Token contract address");
      });
  
      it("Should reject Fixed-Price Sale because the price is invalid", async () => {
        const { Marketplace, NFTCollection, PaymentToken } = await loadFixture(deployFixture1);
  
        await expect(
          Marketplace.createFixedPriceSale(
            NFTCollection.address,
            PaymentToken.address,
            0,
            0
          )
        ).to.be.revertedWith("Invalid price");
      });
  
      it("Should reject Fixed-Price Sale because caller is not the owner of the NFT", async () => {
        const { Marketplace, NFTCollection, PaymentToken, USER1 } = await loadFixture(deployFixture1);
  
        await expect(
          Marketplace.connect(USER1).createFixedPriceSale(
            NFTCollection.address,
            PaymentToken.address,
            0,
            50
          )
        ).to.be.revertedWith("Caller is not the owner of the NFT");
      });
  
      it("Should reject Fixed-Price Sale because owner of the NFT hasn't approved ownership transfer", async () => {
        const { Marketplace, NFTCollection, PaymentToken, USER3 } = await loadFixture(deployFixture1);
  
        await expect(
          Marketplace.connect(USER3).createFixedPriceSale(
            NFTCollection.address,
            PaymentToken.address,
            0,
            50
          )
        ).to.be.revertedWith("Require NFT ownership transfer approval");
      });
    });
  
    describe("Create Fixed-Price Sale - Success", () => {
      it("Should create a new Fixed-Price Sale", async () => {
        const { Marketplace, NFTCollection, PaymentToken, USER3 } = await loadFixture(deployFixture1);
  
        await NFTCollection.connect(USER3).approve(Marketplace.address, 0);
  
        await expect(
          Marketplace.connect(USER3).createFixedPriceSale(
            NFTCollection.address,
            PaymentToken.address,
            0,
            50
          )
        )
          .to.emit(Marketplace, "NewFixedPriceSale")
          .withArgs(0, NFTCollection.address, PaymentToken.address, 50, USER3.address);
      });
    });
  
    describe("Buy NFT - Failure", () => {
      it("Should reject buying NFT because the sale is not active", async () => {
        const { Marketplace, NFTCollection, PaymentToken, USER1 } = await loadFixture(deployFixture1);
  
        await expect(Marketplace.connect(USER1).buyNFT(0)).to.be.revertedWith("Sale is not active");
      });
    });
  
    describe("Buy NFT with tokens - Success", () => {
      it("Should buy NFT at a fixed price with token", async () => {
        const { Marketplace, NFTCollection, PaymentToken, USER1, USER3 } = await loadFixture(deployFixture1);
  
        await NFTCollection.connect(USER3).approve(Marketplace.address, 0);
        await Marketplace.connect(USER3).createFixedPriceSale(
          NFTCollection.address,
          PaymentToken.address,
          0,
          50
        );
  
        await PaymentToken.connect(USER1).approve(Marketplace.address, 50);
        await PaymentToken.transfer(USER1.address, 50);
  
        await expect(Marketplace.connect(USER1).buyNFT(0))
          .to.emit(Marketplace, "NFTPurchased")
          .withArgs(0, USER1.address);
      });
    });
    describe("Buy NFT with Ether - Success", () => {
      it("Should buy NFT at a fixed price with Ether", async () => {
        const { Marketplace, NFTCollection, PaymentToken, USER1, USER3 } = await loadFixture(deployFixture1);
  
        await NFTCollection.connect(USER3).approve(Marketplace.address, 0);
        await Marketplace.connect(USER3).createFixedPriceSale(
          NFTCollection.address,
          "0x0000000000000000000000000000000000000000",
          0,
          50
        );
        const price1 = ethers.utils.parseEther("10");
        await expect(Marketplace.connect(USER1).buyNFT(0, {value: price1})).to.be.revertedWith("Not enough value");
      
        const price2 = ethers.utils.parseEther("50");
        await expect(Marketplace.connect(USER1).buyNFT(0, {value: price2}))
          .to.emit(Marketplace, "NFTPurchased")
          .withArgs(0, USER1.address);
      });
      it("Should buy NFT at a fixed price with Ether(pay rest of Ether)", async () => {
        const { Marketplace, NFTCollection, PaymentToken, USER1,USER3 } = await loadFixture(deployFixture1);
  
        await NFTCollection.connect(USER3).approve(Marketplace.address, 0);
        await Marketplace.connect(USER3).createFixedPriceSale(
          NFTCollection.address,
          "0x0000000000000000000000000000000000000000",
          0,
          50
        );     
        const price2 = ethers.utils.parseEther("100");
        await expect(Marketplace.connect(USER1).buyNFT(0, {value: price2}))
          .to.emit(Marketplace, "NFTPurchased")
          .withArgs(0, USER1.address);
      });
    });
  
    describe("End Fixed-Price Sale - Failure", () => {
      it("Should reject ending Fixed-Price Sale because caller is not the seller", async () => {
        const { Marketplace, NFTCollection, PaymentToken, USER1, USER3 } = await loadFixture(deployFixture1);
  
        await NFTCollection.connect(USER3).approve(Marketplace.address, 0);
        await Marketplace.connect(USER3).createFixedPriceSale(
          NFTCollection.address,
          PaymentToken.address,
          0,
          50
        );
  
        await expect(Marketplace.connect(USER1).endFixedPriceSale(0)).to.be.revertedWith("Only the seller can end the sale");
      });
    });
  
    describe("End Fixed-Price Sale - Success", () => {
      it("Should end Fixed-Price Sale", async () => {
        const { Marketplace, NFTCollection, PaymentToken, USER3 } = await loadFixture(deployFixture1);
  
        await NFTCollection.connect(USER3).approve(Marketplace.address, 0);
        await Marketplace.connect(USER3).createFixedPriceSale(
          NFTCollection.address,
          PaymentToken.address,
          0,
          50
        );
  
        await expect(Marketplace.connect(USER3).endFixedPriceSale(0))
          .to.emit(Marketplace, "FixedPriceSaleEnded")
          .withArgs(0);
      });
    });
  });
});
