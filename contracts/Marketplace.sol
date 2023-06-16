// SPDX-License-Identifier: MIT

pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./NFTCollection.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "hardhat/console.sol";

contract Marketplace is Ownable, ReentrancyGuard {
    // Name of the marketplace
    string public name;

    // Index of auctions
    uint256 public auctionIndex;
    uint256 public fixedSaleIndex;

    // Structure to define auction properties
    struct Auction {
        uint256 index;
        address addressNFTCollection; // Address of the ERC721 NFT Collection contract
        address addressPaymentToken; // Address of the ERC20 Payment Token contract
        uint256 nftId;
        address creator;
        uint256 startPrice;
        uint256 endPrice;
        uint256 startAuction;
        uint256 endAuction;
        uint256 period;
        bool active;
    }

    struct FixedPriceSale {
        uint256 index;
        uint256 nftId;
        address addressNFTCollection;
        address addressPaymentToken;
        uint256 price;
        address seller;
        bool active;
    }

    mapping(address => bool) public paymentTokens;
    mapping(address => bool) public acceptedNFTCollection;
    // Array will all auctions
    Auction[] public allAuctions;
    FixedPriceSale[] public allFixedPriceSales;

    event NewAuction(
        uint256 index,
        address addressNFTCollection,
        address addressPaymentToken,
        uint256 nftId,
        address mintedBy,
        uint256 startPrice,
        uint256 endPrice,
        uint256 endAuction
    );

    event NewFixedPriceSale(
        uint256 index,
        uint256 nftId,
        address addressNFTCollection,
        address addressPaymentToken,
        uint256 price,
        address seller
    );

    event FixedPriceSaleEnded(uint256 nftId);
    event AuctionFinished(uint256 auctionIndex, uint256 price);
    event NFTPurchased(uint256 nftId, address buyer);
    event AuctionCanceled(
        uint256 auctionIndex,
        uint256 nftId,
        address claimedBy
    );

    modifier checkAuctionIndex(uint256 _auctionIndex) {
        require(_auctionIndex < allAuctions.length, "Invalid auction index");
        _;
    }
    modifier checkFixedSaleIndex(uint256 _fixedSaleIndex) {
        require(
            _fixedSaleIndex < allFixedPriceSales.length,
            "Invalid auction index"
        );
        _;
    }

    constructor(string memory _name) {
        name = _name;
        paymentTokens[address(0)] = true;
    }

    function createAuction(
        address _addressNFTCollection,
        address _addressPaymentToken,
        uint256 _nftId,
        uint256 _initialBid,
        uint256 _endBid,
        uint256 _auctionPeriod
    ) external returns (uint256) {
        //Check is addresses are valid
        require(
            acceptedNFTCollection[_addressNFTCollection] == true,
            "Invalid NFT Collection contract address"
        );
        require(
            paymentTokens[_addressPaymentToken] == true,
            "Invalid Payment Token contract address"
        );
        require(_auctionPeriod > 0, "Invalid auction period");
        require(_initialBid > 0, "Invalid initial bid price");
        //   require(_endBid > _initialBid, "Invalid end bid price");
        NFTCollection nftCollection = NFTCollection(_addressNFTCollection);
        require(
            nftCollection.ownerOf(_nftId) == msg.sender,
            "Caller is not the owner of the NFT"
        );
        require(
            nftCollection.getApproved(_nftId) == address(this),
            "Require NFT ownership transfer approval"
        );

        // Create new Auction object
        Auction memory newAuction = Auction({
            index: auctionIndex,
            addressNFTCollection: _addressNFTCollection,
            addressPaymentToken: _addressPaymentToken,
            nftId: _nftId,
            creator: msg.sender,
            startPrice: _initialBid,
            endPrice: _endBid,
            startAuction: block.timestamp,
            endAuction: block.timestamp + _auctionPeriod,
            period: _auctionPeriod,
            active: true
        });
        allAuctions.push(newAuction); //update list

        // Trigger event and return index of new auction
        emit NewAuction(
            auctionIndex,
            _addressNFTCollection,
            _addressPaymentToken,
            _nftId,
            msg.sender,
            _initialBid,
            _endBid,
            block.timestamp + _auctionPeriod
        );
        auctionIndex++; // increment auction sequence
        return auctionIndex;
    }

    function bid(
        uint256 _auctionIndex,
        uint256 _newBid
    ) external payable checkAuctionIndex(_auctionIndex) nonReentrant {
        uint256 currentPrice;
        Auction storage auction = allAuctions[_auctionIndex];
        require(isOpen(_auctionIndex), "Auction is not open");
        if (auction.endPrice > auction.startPrice) {
            currentPrice =
                auction.startPrice +
                ((auction.endPrice - auction.startPrice) *
                    (block.timestamp - auction.startAuction)) /
                auction.period;
        } else {
            currentPrice =
                auction.startPrice -
                ((auction.startPrice - auction.endPrice) *
                    (block.timestamp - auction.startAuction)) /
                auction.period;
        }
        require(
            _newBid >= currentPrice,
            "New bid price must be higher than the current price"
        );
        require(
            msg.sender != auction.creator,
            "Creator of the auction cannot place new bid"
        );
        require(auction.active == true, "Auction is liquidated");
        if (auction.addressPaymentToken != address(0)) {
            // ERC20 token
            IERC20 paymentToken = IERC20(auction.addressPaymentToken);
            paymentToken.transferFrom(msg.sender, address(this), currentPrice);
            paymentToken.transfer(auction.creator, currentPrice);
        } else {
            // Ether
            require(msg.value >= _newBid * 10 ** 18, "Not enough value");
            if (msg.value > currentPrice * 10 ** 18)
                payable(msg.sender).transfer(
                    msg.value - currentPrice * 10 ** 18
                );
            payable(auction.creator).transfer(currentPrice * 10 ** 18);
        }
        NFTCollection nftCollection = NFTCollection(
            auction.addressNFTCollection
        );
        // Lock NFT in Marketplace contract
        nftCollection.transferNFTFrom(
            auction.creator,
            msg.sender,
            auction.nftId
        );
        auction.active = false;
        emit AuctionFinished(_auctionIndex, currentPrice);
    }

    function createFixedPriceSale(
        address _addressNFTCollection,
        address _addressPaymentToken,
        uint256 _nftId,
        uint256 _price
    ) external returns (uint256) {
        require(
            acceptedNFTCollection[_addressNFTCollection] == true,
            "Invalid NFT Collection contract address"
        );
        require(
            paymentTokens[_addressPaymentToken] == true,
            "Invalid Payment Token contract address"
        );
        require(_price > 0, "Invalid price");

        NFTCollection nftCollection = NFTCollection(_addressNFTCollection);
        require(
            nftCollection.ownerOf(_nftId) == msg.sender,
            "Caller is not the owner of the NFT"
        );
        require(
            nftCollection.getApproved(_nftId) == address(this),
            "Require NFT ownership transfer approval"
        );
        FixedPriceSale memory newSale = FixedPriceSale({
            index: fixedSaleIndex,
            nftId: _nftId,
            addressNFTCollection: _addressNFTCollection,
            addressPaymentToken: _addressPaymentToken,
            price: _price,
            seller: msg.sender,
            active: true
        });

        allFixedPriceSales.push(newSale);
        // fixedPriceSales[_nftId] = newSale;
        emit NewFixedPriceSale(
            fixedSaleIndex,
            _nftId,
            _addressNFTCollection,
            _addressPaymentToken,
            _price,
            msg.sender
        );
        fixedSaleIndex++;
        return fixedSaleIndex;
    }

    function buyNFT(
        uint256 _index
    ) external payable checkFixedSaleIndex(_index) nonReentrant {
        FixedPriceSale storage sale = allFixedPriceSales[_index];
        require(sale.active, "NFT is sold or FixedPriceSale is ended");

        if (sale.addressPaymentToken != address(0)) {
            //ERC20 token
            IERC20 paymentToken = IERC20(sale.addressPaymentToken);
            paymentToken.transferFrom(msg.sender, sale.seller, sale.price);
        } else {
            //Ether
            require(msg.value >= sale.price * 10 ** 18, "Not enough value");
            payable(sale.seller).transfer(sale.price * 10 ** 18);
            if (msg.value > sale.price * 10 ** 18)
                payable(msg.sender).transfer(msg.value - sale.price * 10 ** 18);
        }

        NFTCollection nftCollection = NFTCollection(sale.addressNFTCollection);
        nftCollection.transferNFTFrom(sale.seller, msg.sender, sale.nftId);

        sale.active = false;

        emit NFTPurchased(_index, msg.sender);
    }

    /**
     * Function used by the creator of an auction to get his NFT back
     * in case the auction is closed but there is no bider to make the NFT won't stay locked in the contract
     */
    function cancelAuction(
        uint256 _auctionIndex
    ) external checkAuctionIndex(_auctionIndex) {
        require(!isOpen(_auctionIndex), "Auction is still open");
        Auction storage auction = allAuctions[_auctionIndex];
        require(
            auction.creator == msg.sender,
            "Tokens can be claimed only by the creator of the auction"
        );
        require(auction.active == true, "Existing bider for this auction");
        auction.active = false;
        emit AuctionCanceled(_auctionIndex, auction.nftId, msg.sender);
    }

    /**
     * Function used by the seller of an FixedPriceSale to get his NFT back
     * in case there is no buyer
     */
    function endFixedPriceSale(
        uint256 _index
    ) external checkFixedSaleIndex(_index) {
        FixedPriceSale storage sale = allFixedPriceSales[_index];
        require(sale.seller == msg.sender, "Only the seller can end the sale");
        require(sale.active == true, "NFT is sold or FixedPriceSale is ended");
        sale.active = false;

        emit FixedPriceSaleEnded(_index);
    }

    // Check if an auction is open
    function isOpen(uint256 _auctionIndex) public view returns (bool) {
        Auction storage auction = allAuctions[_auctionIndex];
        if (block.timestamp > auction.endAuction) return false;
        return true;
    }

    function addPaymentToken(address _addr) public onlyOwner {
        if (isContract(_addr) == true && isERC20Contract(_addr) == true)
            paymentTokens[_addr] = true;
    }

    function addAcceptedNFTCollection(address _addr) public onlyOwner {
        if (isContract(_addr) == true && isERC721Contract(_addr) == true)
            acceptedNFTCollection[_addr] = true;
    }

    function removePaymentToken(address _addr) public onlyOwner {
        if (paymentTokens[_addr] == true) paymentTokens[_addr] = false;
    }

    function removeAcceptedNFTCollection(address _addr) public onlyOwner {
        if (acceptedNFTCollection[_addr] == true)
            acceptedNFTCollection[_addr] = false;
    }

    function isERC20Contract(address _address) private view returns (bool) {
        (bool success, ) = _address.staticcall(
            abi.encodeWithSignature("totalSupply()")
        );
        return success;
    }

    function isERC721Contract(address _address) private view returns (bool) {
        (bool success, ) = _address.staticcall(
            abi.encodeWithSignature(
                "supportsInterface(bytes4)",
                bytes4(
                    keccak256("onERC721Received(address,address,uint256,bytes)")
                )
            )
        );
        return success;
    }

    function isContract(address _addr) private view returns (bool) {
        uint256 size;
        assembly {
            size := extcodesize(_addr)
        }
        return size > 0;
    }
}
